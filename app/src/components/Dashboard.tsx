import {useEffect, useMemo} from 'react'
import {useQuery, useQueryClient, type QueryClient} from '@tanstack/react-query'
import {schemasQuery, type Doc} from '../lib/data'
import {isDocumentType} from '../lib/creatable'
import {useLivePausedToast, useReconnectingToast} from '../lib/connection'
import {applyRowFrame, quietRead, replayFrames, resolveWidgets, taskFrameKind, withTaskFrame, type Resolved, type RowFrame, type RowsKind} from '../lib/dashboard'
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
 * read.
 *
 * A read that is out was answered from before the frames heard since: they are kept, and put
 * back onto its answer when it lands (replayFrames). The read is never cancelled or repeated
 * for a frame. Only what a frame cannot tell (a row gone from a full list, a document not
 * among the rows whose published version is unknown, a list in an order of its own) asks for
 * a read, and then ONE per widget once frames have gone quiet (quietRead).
 */
function useLiveRows() {
  const qc = useQueryClient()
  const {data: schemas} = useQuery(schemasQuery)
  const types = useMemo(() => (schemas ?? []).filter(isDocumentType).map((s) => s.name), [schemas])
  useLive([], types.length ? [...types, TASK_TYPE] : [])
  useEffect(() => {
    const live: Live = {qc, asked: new Map(), heard: new Map(), outside: new Map()}
    // The frames heard while a read is out, from when it goes out to when it lands.
    const unsubscribe = qc.getQueryCache().subscribe((e) => {
      if (e.type !== 'updated' || e.query.queryKey[0] !== 'dashboard') return
      const k = JSON.stringify(e.query.queryKey)
      if (e.action.type === 'fetch') live.heard.set(k, [])
      else if (e.action.type === 'error') live.heard.delete(k)
      else if (e.action.type === 'success' && !e.action.manual) {
        const frames = live.heard.get(k)
        live.heard.delete(k)
        // After the cache has told everyone of the answer, before any other frame is heard.
        if (frames?.length) queueMicrotask(() => land(live, e.query.queryKey, frames))
      }
    })
    const desk = new Set(types)
    const off = onDocFrame((f) => {
      if (f.type !== TASK_TYPE && !desk.has(f.type)) return
      for (const q of qc.getQueryCache().findAll({queryKey: ['dashboard']})) {
        if (!concerns(q.queryKey, f)) continue
        if (fetching(qc, q.queryKey)) {
          // A read begun before this page listened to the cache (a widget's first) is out too.
          const k = JSON.stringify(q.queryKey)
          live.heard.set(k, [...(live.heard.get(k) ?? []), f])
        }
        applyTo(live, q.queryKey, f, false)
      }
    })
    return () => (off(), unsubscribe(), live.asked.forEach((a) => clearTimeout(a.timer)))
  }, [qc, types])
}

type Key = readonly unknown[]
type Live = {
  qc: QueryClient
  /** The one read each widget waits for (quietRead). */
  asked: Map<string, {first: number; timer: ReturnType<typeof setTimeout>}>
  heard: Map<string, Frame[]>
  // Last created lists: a draft's frame cannot say when its document was created (lib/dashboard.ts
  // docRows), so a document that is no row costs one read, and is then known not to be one.
  outside: Map<string, Set<string>>
}

const fetching = (qc: QueryClient, key: Key) => qc.isFetching({queryKey: key, exact: true}) > 0
const publishedIdOf = (f: Frame) => f.documentId.replace(/^drafts\./, '')
const isRemoved = (f: Frame) => !f.result || f.mutation === 'delete' || f.mutation === 'discardDraft'
const kindOf = (key: Key) => ({only: key[2], types: key[3], order: key[4], limit: key[5]}) as RowsKind

/** Whether a frame is this widget's business: tasks for My tasks, the desk's documents (of its types) for the others. */
function concerns(key: Key, f: Frame) {
  if (key[1] === 'tasks') return f.type === TASK_TYPE
  if (f.type === TASK_TYPE) return false
  if (key[1] === 'rows') return !kindOf(key).types || kindOf(key).types!.includes(f.type)
  return key[1] === 'scheduled'
}

/** One read of `key`, once frames have stopped asking (or 5 s after the first): never one per frame, never over a read that is out. */
function ask(live: Live, key: Key) {
  const k = JSON.stringify(key)
  const was = live.asked.get(k)
  if (was) clearTimeout(was.timer)
  const {first, at} = quietRead(was, Date.now())
  const timer = setTimeout(() => {
    live.asked.delete(k)
    // A read that is out began after the frame that asked (one out before it is replayed onto, and asks again if it must).
    if (!fetching(live.qc, key)) void live.qc.invalidateQueries({queryKey: key, exact: true})
  }, at - Date.now())
  live.asked.set(k, {first, timer})
}

/**
 * A frame into one widget's data. `landed`: it is being put back onto a read's answer. While
 * a read is out (and not `landed`) nothing asks for another: the frame is kept and decides
 * when the answer lands.
 */
function applyTo(live: Live, key: Key, f: Frame, landed: boolean) {
  const {qc} = live
  const out = !landed && fetching(qc, key)
  const id = publishedIdOf(f)
  if (key[1] === 'tasks') {
    const tasks = qc.getQueryData<Task[]>(key)
    const what = taskFrameKind(f.documentId, f.mutation, !!f.result)
    if (what === 'read') return void (!out && ask(live, key))
    if (tasks) qc.setQueryData(key, withTaskFrame(tasks, id, what === 'remove' ? null : (f.result as unknown as Task)))
    return
  }
  if (key[1] === 'scheduled') {
    // Each row shows its document: a draft's frame is the document as it now reads. Published (its
    // schedule ran, or someone published it) or gone: the schedules are read again.
    const data = qc.getQueryData<Upcoming>(key)
    if (!data?.rows.some((r) => r.schedule.documentId.replace(/^drafts\./, '') === id)) return
    if (isRemoved(f) || !f.documentId.startsWith('drafts.')) return void (!out && ask(live, key))
    const doc = f.result!
    return void qc.setQueryData<Upcoming>(key, {...data, rows: data.rows.map((r) => (r.doc && r.doc._publishedId === id && r.doc._updatedAt <= doc._updatedAt ? {...r, doc: {...doc, _hasPublished: r.doc._hasPublished, _publishedAt: r.doc._publishedAt} as Doc} : r))})
  }
  const rows = qc.getQueryData<Doc[]>(key)
  if (!rows) return
  const frame = rowFrame(f)
  const next = applyRowFrame(rows, frame, kindOf(key))
  if (next !== null) return void (next !== rows && qc.setQueryData(key, next))
  if (!out) askForRow(live, key, rows, frame)
}

const rowFrame = (f: Frame): RowFrame => ({id: publishedIdOf(f), doc: isRemoved(f) ? null : f.result})

/** A read's answer is in: the frames heard while it was out go back onto it (replayFrames), and only what they cannot tell asks again. */
function land(live: Live, key: Key, frames: Frame[]) {
  if (key[1] !== 'rows') return frames.forEach((f) => applyTo(live, key, f, true))
  const answer = live.qc.getQueryData<Doc[]>(key)
  if (!answer) return
  const {rows, unplaced} = replayFrames(answer, frames.map(rowFrame), kindOf(key))
  if (rows !== answer) live.qc.setQueryData(key, rows)
  for (const f of unplaced) askForRow(live, key, rows, f)
}

/** A frame the rows cannot take: one read, unless it is a draft a last-created list already knows is none of its rows. */
function askForRow(live: Live, key: Key, rows: Doc[], f: RowFrame) {
  if (f.doc?._draft && kindOf(key).order === '_createdAt desc' && !rows.some((r) => r._publishedId === f.id)) {
    const k = JSON.stringify(key)
    if (live.outside.get(k)?.has(f.id)) return
    live.outside.set(k, (live.outside.get(k) ?? new Set()).add(f.id))
  }
  ask(live, key)
}
