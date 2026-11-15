import {useEffect, useMemo} from 'react'
import {useQuery, useQueryClient, type QueryClient} from '@tanstack/react-query'
import {schemasQuery, type Doc} from '../lib/data'
import {isDocumentType} from '../lib/creatable'
import {resolveWidgets, withFrame, withoutFrame, type Resolved, type RowsKind} from '../lib/dashboard'
import type {Upcoming} from '../lib/dashboard-data'
import {onDocFrame, useLive, type Frame} from '../lib/live'
import {setPresenceSelf, usePresenceStream} from '../lib/presence'
import {meQuery} from '../lib/session'
import {TASK_TYPE} from '../lib/tasks'
import {useT} from '../lib/i18n'
import studio from '../studio.config'
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
  const self = useQuery(meQuery).data?.presenceName ?? null
  useEffect(() => setPresenceSelf(self), [self])
}

/**
 * Live rows. The tab's stream follows the desk's document types and the studio's tasks;
 * lib/live.ts reads the tasks again by itself. Each document frame is put into every list
 * widget's rows (lib/dashboard.ts withFrame): an editor typing somewhere is a frame a
 * second, and none of them may be a read. Only what a frame cannot tell is read again, once
 * per burst: a row gone from a full list, a document not among the rows whose published
 * version is unknown, a list in an order of its own.
 */
function useLiveRows() {
  const qc = useQueryClient()
  const {data: schemas} = useQuery(schemasQuery)
  const types = useMemo(() => (schemas ?? []).filter(isDocumentType).map((s) => s.name), [schemas])
  useLive([], types.length ? [...types, TASK_TYPE] : [])
  useEffect(() => {
    const again = new Map<string, ReturnType<typeof setTimeout>>()
    const readAgain = (key: readonly unknown[]) => {
      const k = JSON.stringify(key)
      if (again.has(k)) return
      again.set(k, setTimeout(() => (again.delete(k), void qc.invalidateQueries({queryKey: key, exact: true})), READ_AGAIN_MS))
    }
    const off = onDocFrame((f) => applyFrame(qc, f, readAgain))
    return () => (off(), again.forEach(clearTimeout))
  }, [qc])
}
const READ_AGAIN_MS = 400

function applyFrame(qc: QueryClient, f: Frame, readAgain: (key: readonly unknown[]) => void) {
  const id = f.documentId.replace(/^drafts\./, '')
  const removed = !f.result || f.mutation === 'delete' || f.mutation === 'discardDraft'
  for (const [key, rows] of qc.getQueriesData<Doc[]>({queryKey: ['dashboard', 'rows']})) {
    if (!rows) continue
    const kind = {only: key[2], types: key[3], order: key[4], limit: key[5]} as RowsKind
    if (kind.types && !kind.types.includes(f.type)) continue
    const next = removed ? withoutFrame(rows, id) : withFrame(rows, f.result!, kind)
    if (next === null) readAgain(key)
    else if (next !== rows) qc.setQueryData(key, next)
  }
  // A scheduled draft was published (its schedule ran, or someone published it), or is gone: Scheduled reads again.
  if (removed || !f.documentId.startsWith('drafts.'))
    for (const [key, data] of qc.getQueriesData<Upcoming>({queryKey: ['dashboard', 'scheduled']}))
      if (data?.rows.some((r) => r.schedule.documentId.replace(/^drafts\./, '') === id)) readAgain(key)
}
