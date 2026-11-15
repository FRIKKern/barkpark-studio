import {useEffect, useMemo} from 'react'
import {useQuery, useQueryClient, type QueryClient} from '@tanstack/react-query'
import {schemasQuery, type Doc} from '../lib/data'
import {isDocumentType} from '../lib/creatable'
import {useLivePausedToast, useReconnectingToast} from '../lib/connection'
import {frameStep, resolveWidgets, withFrame, withoutFrame, withTaskFrame, type Resolved, type RowsKind} from '../lib/dashboard'
import {dashboardTasksQuery, type Upcoming} from '../lib/dashboard-data'
import {onDocFrame, useLive, type Frame} from '../lib/live'
import {setPresenceSelf, usePresenceStream} from '../lib/presence'
import {meQuery} from '../lib/session'
import {TASK_TYPE, type Task} from '../lib/tasks'
import {useT} from '../lib/i18n'
import studio from '../studio.config'
import {usePrefetchDocPane} from './DocPane'
import {DocListWidget} from './dashboard/DocListWidget'
import {MembersWidget, ProjectInfoWidget} from './dashboard/MembersWidget'
import {ScheduledWidget} from './dashboard/ScheduledWidget'
import {TasksWidget} from './dashboard/TasksWidget'
import {WidgetFrame} from './dashboard/Widget'

// The Dashboard tool (Sanity's @sanity/dashboard): the studio config's widgets in a grid
// that goes from one column on a phone to four. Each widget reads for itself and fails for
// itself. The page listens on the tab's one stream (lib/live.ts) to the desk's types and to
// tasks; a frame goes into the widgets' rows here, with no read.

const WIDGETS = resolveWidgets(studio.dashboard)

export function Dashboard() {
  const t = useT()
  usePresence()
  useLiveRows()
  return (
    <main className="dashboard" data-testid="dashboard">
      <h1 className="sr-only">{t('Dashboard')}</h1>
      {WIDGETS.length ? (
        <div className="dash-grid">
          {WIDGETS.map((w) => (
            <Widget key={w.key} widget={w} />
          ))}
        </div>
      ) : (
        // Sanity's words for a dashboard with no widgets.
        <p className="dash-none muted">{t('Add some widgets to populate this space.')}</p>
      )}
    </main>
  )
}

function Widget({widget}: {widget: Resolved}) {
  const t = useT()
  if (widget.kind === 'custom') {
    const Custom = widget.component
    return (
      <WidgetFrame title={widget.title ? t(widget.title) : widget.key.replace(/^custom-/, '')} width={widget.width} testId={`dash-${widget.key}`}>
        <Custom />
      </WidgetFrame>
    )
  }
  if (widget.kind === 'tasks') return <TasksWidget widget={widget} />
  if (widget.kind === 'scheduled') return <ScheduledWidget widget={widget} />
  if (widget.kind === 'members') return <MembersWidget widget={widget} />
  if (widget.kind === 'projectInfo') return <ProjectInfoWidget widget={widget} />
  return <DocListWidget widget={widget} />
}

/** This tab in the presence room (J07), as Structure's pages are: the Members widget and the rows show who is here. */
function usePresence() {
  usePresenceStream()
  // The document pane's chunk, fetched while idle as the desk does: a row's first open does not wait for it.
  usePrefetchDocPane()
  // A live page says when it is not: "Trying to connect…", "Live updates paused" (J50).
  useReconnectingToast()
  useLivePausedToast()
  const self = useQuery(meQuery).data?.presenceName ?? null
  useEffect(() => setPresenceSelf(self), [self])
}

/**
 * Live rows. The tab's stream follows the desk's document types and the studio's tasks. Each
 * frame is put into the rows of every widget it concerns (lib/dashboard.ts withFrame,
 * withTaskFrame): an editor typing somewhere is a frame a second, and none of them may be a
 * read. Only what a frame cannot tell is read again, once per burst: a row gone from a full
 * list, a document not among the rows whose published version is unknown, a list in an order
 * of its own. And a frame that comes while a read of those rows is out (frameStep): that read
 * was answered from before the frame, and would put the older rows back.
 */
function useLiveRows() {
  const qc = useQueryClient()
  const {data: schemas} = useQuery(schemasQuery)
  const types = useMemo(() => (schemas ?? []).filter(isDocumentType).map((s) => s.name), [schemas])
  useLive([], types.length ? [...types, TASK_TYPE] : [])
  useEffect(() => {
    const again = new Map<string, ReturnType<typeof setTimeout>>()
    // One read per burst, begun after the burst's last write was heard; it takes the place of a read still out.
    const readAgain = (key: readonly unknown[]) => {
      const k = JSON.stringify(key)
      if (again.has(k)) return
      again.set(k, setTimeout(() => (again.delete(k), void qc.invalidateQueries({queryKey: key, exact: true})), READ_AGAIN_MS))
    }
    // Last created lists: a draft's frame cannot say when its document was created (lib/dashboard.ts
    // docRows), so a document that is no row costs one read, and is then known not to be one.
    const outside = new Map<string, Set<string>>()
    const desk = new Set(types)
    const off = onDocFrame((f) => (f.type === TASK_TYPE ? applyTaskFrame(qc, f, readAgain) : desk.has(f.type) && applyFrame(qc, f, readAgain, outside)))
    return () => (off(), again.forEach(clearTimeout))
  }, [qc, types])
}
const READ_AGAIN_MS = 400

const fetching = (qc: QueryClient, key: readonly unknown[]) => qc.isFetching({queryKey: key, exact: true}) > 0

function applyFrame(qc: QueryClient, f: Frame, readAgain: (key: readonly unknown[]) => void, outside: Map<string, Set<string>>) {
  const id = f.documentId.replace(/^drafts\./, '')
  const removed = !f.result || f.mutation === 'delete' || f.mutation === 'discardDraft'
  for (const [key, rows] of qc.getQueriesData<Doc[]>({queryKey: ['dashboard', 'rows']})) {
    const kind = {only: key[2], types: key[3], order: key[4], limit: key[5]} as RowsKind
    if (kind.types && !kind.types.includes(f.type)) continue
    const out = fetching(qc, key)
    const next = !rows ? undefined : removed ? withoutFrame(rows, id) : withFrame(rows, f.result!, kind)
    const step = frameStep(rows, next, out)
    if (step.set) qc.setQueryData(key, step.set)
    if (!step.read) continue
    if (rows && next === null && !out && !removed && kind.order === '_createdAt desc' && f.result!._draft && !rows.some((r) => r._publishedId === id)) {
      const k = JSON.stringify(key)
      if (outside.get(k)?.has(id)) continue
      outside.set(k, (outside.get(k) ?? new Set()).add(id))
    }
    readAgain(key)
  }
  // A scheduled draft was published (its schedule ran, or someone published it), or is gone: Scheduled reads again.
  // So does a frame for one of its documents while its read is out (the row shows the document).
  for (const [key, data] of qc.getQueriesData<Upcoming>({queryKey: ['dashboard', 'scheduled']})) {
    const mine = data?.rows.some((r) => r.schedule.documentId.replace(/^drafts\./, '') === id)
    if (fetching(qc, key) || (mine && (removed || !f.documentId.startsWith('drafts.')))) readAgain(key)
    else if (mine && data && f.result) qc.setQueryData<Upcoming>(key, {...data, rows: data.rows.map((r) => (r.doc && r.doc._publishedId === id && r.doc._updatedAt <= f.result!._updatedAt ? {...r, doc: {...f.result!, _hasPublished: r.doc._hasPublished, _publishedAt: r.doc._publishedAt} as Doc} : r))})
  }
}

/** A task changed (created, assigned, done, deleted): into My tasks' rows, as documents go into theirs. */
function applyTaskFrame(qc: QueryClient, f: Frame, readAgain: (key: readonly unknown[]) => void) {
  const key = dashboardTasksQuery.queryKey
  const tasks = qc.getQueryData<Task[]>(key)
  const out = fetching(qc, key)
  const removed = !f.result || f.mutation === 'delete' || f.mutation === 'discardDraft'
  if (tasks) qc.setQueryData(key, withTaskFrame(tasks, f.documentId.replace(/^drafts\./, ''), removed ? null : (f.result as unknown as Task)))
  if (out) readAgain(key)
}
