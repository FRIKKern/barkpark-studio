import {useEffect, useId, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {deleteTask, tasksQuery, updateTask, type Task, type TaskState} from '../lib/tasks'
import {duplicateOf} from '../lib/task-activity'
import {showTasks, useActiveDocument, useTasksView, type TasksTab} from '../lib/tasks-ui'
import {meQuery, useCanWrite} from '../lib/session'
import {useLocale, useT} from '../lib/i18n'
import {useLive} from '../lib/live'
import {toast} from './Toasts'
import {unsavedElsewhere} from '../lib/edits'
import {DialogBox, MenuPopover} from './FocusScopes'
import {DateTimeInput} from './DateTimeInput'
import {Add, CheckmarkCircle, ChevronDown, ChevronLeft, ChevronRight, Close, DocumentIcon, Ellipsis, UserIcon} from './icons'
import {usePrimed} from '../lib/prime'
import {AssigneeField, DATE_HINT, Header, TargetField, TargetTitle} from './TaskFields'
import {CreateTask} from './TaskCreate'
import {TaskActivity} from './TaskActivity'

/**
 * J66, Sanity's Tasks sidebar: the navbar's Tasks button opens it on the Assigned /
 * Subscribed / Active Document lists; a document's "Create new task" opens it on the
 * create form with that document as the target; a task opens on its own view with its
 * status, fields and activity. Docked at the right under the navbar, as Sanity's.
 */
export function TasksPanel() {
  const t = useT()
  const view = useTasksView()
  const open = view.kind !== 'closed'
  // A task's link (Copy link to task): ?task=<id> opens it here once, then leaves the URL.
  useEffect(() => {
    const url = new URL(location.href)
    const id = url.searchParams.get('task')
    if (!id) return
    showTasks({kind: 'task', id})
    url.searchParams.delete('task')
    history.replaceState(history.state, '', url)
  }, [])
  useEffect(() => {
    if (!open) return
    document.body.dataset.tasksOpen = ''
    return () => void delete document.body.dataset.tasksOpen
  }, [open])
  // Live while open: another editor's change to a task, or a comment on one, shows here (lib/live.ts).
  useLive([], open ? ['studioTask', 'studioComment'] : [])
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <aside className="tasks-panel" aria-label={t('Tasks')}>
      {view.kind === 'list' && <TaskList tab={view.tab} />}
      {view.kind === 'create' && <CreateTask key={view.draft ?? view.from?.title ?? view.target?.id ?? 'none'} target={view.target} draft={view.draft} from={view.from} />}
      {view.kind === 'task' && <TaskView id={view.id} list={view.list} />}
    </aside>,
    document.body,
  )
}


const TABS: [TasksTab, string][] = [
  ['assigned', 'Assigned'],
  ['subscribed', 'Subscribed'],
  ['document', 'Active Document'],
]
const EMPTY: Record<TasksTab, [string, string]> = {
  assigned: ["You haven't been assigned any tasks", "Once you're assigned tasks they'll show up here"],
  subscribed: ["You haven't subscribed to any tasks", 'When you create, modify, or comment on a task you will be subscribed automatically'],
  document: ["This document doesn't have any tasks yet", 'Once a document has connected tasks, they will be shown here.'],
}

function TaskList({tab}: {tab: TasksTab}) {
  const t = useT()
  const me = useQuery(meQuery).data?.email ?? null
  const active = useActiveDocument()
  const {canWrite, createReason} = useCanWrite()
  const {data: tasks = [], isPending} = useQuery(tasksQuery)
  // A draft is not a task yet: it is under the create form's Draft menu (TaskCreate.tsx).
  const shown = tasks.filter((x) => x.state !== 'draft').filter((x) => (tab === 'assigned' ? !!me && x.assignee === me : tab === 'subscribed' ? !!me && (x.subscribers ?? []).includes(me) : !!active && x.target?._ref === active.id))
  const open = shown.filter((x) => x.state !== 'done')
  const done = shown.filter((x) => x.state === 'done')
  const order = [...open, ...done].map((x) => x._id)
  const primed = usePrimed(shown.flatMap((x) => (x.target ? [{types: null, id: x.target._ref}] : [])))
  const [heading, text] = tab === 'document' && !active ? ['Open a document to see its task', 'Tasks on your active document will be shown here.'] : EMPTY[tab]
  return (
    <>
      <Header>
        <h2>{t('Tasks')}</h2>
        {/* J49: a read seat cannot write a task (Barkpark refuses it), so it is not offered one. */}
        <button type="button" className="btn-text tasks-new" disabled={!canWrite} title={createReason} onClick={() => showTasks({kind: 'create', target: active})}>
          <Add /> {t('New task')}
        </button>
      </Header>
      <div className="tasks-tabs" role="tablist" aria-label={t('Tasks')}>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => showTasks({kind: 'list', tab: id})}>
            {t(label)}
          </button>
        ))}
      </div>
      <div className="tasks-body">
        {isPending ? (
          <p className="muted">{t('Loading…')}</p>
        ) : shown.length === 0 ? (
          <div className="tasks-empty">
            <h3>{t(heading)}</h3>
            <p>{t(text)}</p>
            <button type="button" className="btn btn-primary" disabled={!canWrite} title={createReason} onClick={() => showTasks({kind: 'create', target: active})}>
              <Add /> {t('Create new task')}
            </button>
          </div>
        ) : (
          <>
            {/* Sanity's two groups: To Do open, Done folded, each a header with its chevron. */}
            {open.length > 0 && (
              <details className="tasks-group" open>
                <summary>
                  {t('To Do')} <ChevronDown />
                </summary>
                <ul className="tasks-list" aria-label={t('To Do')}>
                  {open.map((x) => (
                    <TaskRow key={x._id} task={x} list={order} primed={primed} />
                  ))}
                </ul>
              </details>
            )}
            {/* Sanity's Done header shows even with nothing done yet. */}
            <details className="tasks-group tasks-done">
              <summary>
                {t('Done')} <ChevronDown />
              </summary>
              <ul className="tasks-list" aria-label={t('Done')}>
                {done.map((x) => (
                  <TaskRow key={x._id} task={x} list={order} primed={primed} />
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </>
  )
}

/** Sanity's status toggle: an empty circle while open, a check when done; in a list row, its checkbox. */
function StatusToggle({task, box = false}: {task: Task; box?: boolean}) {
  const t = useT()
  const qc = useQueryClient()
  const {canWrite} = useCanWrite()
  const done = task.state === 'done'
  const flip = async () => {
    const state: TaskState = done ? 'open' : 'done'
    qc.setQueryData<Task[]>(tasksQuery.queryKey, (all) => all?.map((x) => (x._id === task._id ? {...x, state} : x)))
    try {
      await updateTask({data: {id: task._id, set: {state}}})
    } catch (e) {
      toast({
        tone: 'critical',
        title: t('Could not save the task'),
        description: (e as Error).message,
      })
    }
    void qc.invalidateQueries({queryKey: tasksQuery.queryKey})
  }
  if (box) return <input type="checkbox" className="checkbox task-check" checked={done} disabled={!canWrite} aria-label={t('Change status')} data-tip={t('Change status')} onChange={() => void flip()} />
  return (
    <button
      type="button"
      className="task-status"
      data-done={done || undefined}
      role="checkbox"
      aria-checked={done}
      aria-label={t('Change status')}
      data-tip={t('Change status')}
      disabled={!canWrite}
      onClick={() => void flip()}
    >
      {done ? <CheckmarkCircle /> : <span className="task-circle" />}
    </button>
  )
}

function TaskRow({task, list, primed}: {task: Task; list: string[]; primed: (id: string) => boolean}) {
  const t = useT()
  const locale = useLocale()
  return (
    <li className="task-row" data-done={task.state === 'done' || undefined}>
      <StatusToggle task={task} box />
      <div className="task-text">
        <button type="button" className="task-title" onClick={() => showTasks({kind: 'task', id: task._id, list})}>
          {task.title}
        </button>
        <span className="task-meta muted">
          {task.target && (
            <span className="task-meta-target">
              <DocumentIcon />
              <TargetTitle id={task.target._ref} primed={primed(task.target._ref)} />
            </span>
          )}
          {task.dueAt && <span>{new Date(`${task.dueAt}T00:00:00`).toLocaleDateString(locale === 'nb-NO' ? 'nb-NO' : 'en-US', {month: 'short', day: 'numeric'})}</span>}
        </span>
      </div>
      {task.assignee ? (
        <span className="task-assignee" title={task.assignee} aria-label={task.assignee}>
          {task.assignee.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        <span className="task-assignee none" title={t('Unassigned')} aria-label={t('Unassigned')}>
          <UserIcon />
        </span>
      )}
    </li>
  )
}


function TaskView({id, list = []}: {id: string; list?: string[]}) {
  const t = useT()
  const qc = useQueryClient()
  const ids = useId()
  const {canWrite} = useCanWrite()
  const {data: tasks, isPending} = useQuery(tasksQuery)
  const task = tasks?.find((x) => x._id === id)
  // Shown and then gone: someone deleted it while it was open here.
  const seen = useRef<string>(undefined)
  if (task) seen.current = id
  const at = list.indexOf(id)
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [menu, setMenu] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => void (task && (setTitle(task.title), setDescription(task.description ?? ''))), [task?._id])
  const save = async (set: Parameters<typeof updateTask>[0]['data']['set']) => {
    if (!task) return
    qc.setQueryData<Task[]>(
      tasksQuery.queryKey,
      (all) =>
        all?.map((x) =>
          x._id === id
            ? {
                ...x,
                ...set,
                ...(set.target !== undefined
                  ? {
                      target: set.target ? {_type: 'reference' as const, _ref: set.target.id} : null,
                      targetType: set.target?.type ?? null,
                    }
                  : {}),
              }
            : x,
        ) as Task[],
    )
    try {
      await updateTask({data: {id, set}})
    } catch (e) {
      toast({
        tone: 'critical',
        title: t('Could not save the task'),
        description: (e as Error).message,
      })
    }
    void qc.invalidateQueries({queryKey: tasksQuery.queryKey})
  }
  // The title and description save when the box is left. Typed and not left yet, they are
  // unsaved: leaving the page asks first (B11's prompt), and the leaving tries the save.
  const titleChanged = !!task && !!title.trim() && title !== task.title
  const descriptionChanged = !!task && description !== (task.description ?? '')
  const pending = titleChanged || descriptionChanged
  const flush = useRef(() => {})
  flush.current = () => void ((titleChanged || descriptionChanged) && save({...(titleChanged && {title: title.trim()}), ...(descriptionChanged && {description})}))
  useEffect(() => {
    if (!pending) return
    const unsaved = () => true
    const leaving = () => flush.current()
    unsavedElsewhere.add(unsaved)
    addEventListener('beforeunload', leaving)
    return () => (unsavedElsewhere.delete(unsaved), removeEventListener('beforeunload', leaving))
  }, [pending])

  const remove = async () => {
    setDeleting(false)
    try {
      await deleteTask({data: {id}})
      showTasks({kind: 'list', tab: 'assigned'})
    } catch (e) {
      toast({tone: 'critical', title: t('Could not save the task'), description: (e as Error).message})
    }
    void qc.invalidateQueries({queryKey: tasksQuery.queryKey})
  }
  const copyLink = () => {
    const url = new URL(location.href)
    url.searchParams.set('task', id)
    url.hash = ''
    navigator.clipboard.writeText(url.toString()).then(
      () => toast({title: t('Copied link to clipboard')}),
      () => toast({tone: 'critical', title: t('Unable to copy link to clipboard')}),
    )
  }
  return (
    <>
      <Header>
        <nav className="tasks-crumbs" aria-label={t('Tasks')}>
          <button type="button" className="btn-text" onClick={() => showTasks({kind: 'list', tab: 'assigned'})}>
            {t('Tasks')}
          </button>
          <span className="tasks-crumb-sep" aria-hidden="true">
            <ChevronRight />
          </span>
          <h2>{task?.title ?? '…'}</h2>
        </nav>
        {/* Sanity's: walk the list this task was opened from; its menu duplicates it, copies a link that opens it, deletes it. */}
        <button type="button" className="icon-btn" aria-label={t('Go to previous task')} data-tip={t('Go to previous task')} disabled={at <= 0} onClick={() => showTasks({kind: 'task', id: list[at - 1]!, list})}>
          <ChevronLeft />
        </button>
        <button type="button" className="icon-btn" aria-label={t('Go to next task')} data-tip={t('Go to next task')} disabled={at < 0 || at >= list.length - 1} onClick={() => showTasks({kind: 'task', id: list[at + 1]!, list})}>
          <ChevronRight />
        </button>
        <div className="menu-wrap">
          <button type="button" className="icon-btn" aria-label={t('Task actions')} data-tip={t('Task actions')} aria-haspopup="menu" aria-expanded={menu} disabled={!task} onClick={() => setMenu((o) => !o)}>
            <Ellipsis />
          </button>
          {menu && task && (
            <MenuPopover className="popover menu" onClose={() => setMenu(false)}>
              {/* The copy opens in the create form, kept as a draft until "Create Task" (TaskCreate.tsx). */}
              <button type="button" role="menuitem" className="menu-item" disabled={!canWrite} onClick={() => (setMenu(false), showTasks({kind: 'create', target: null, from: duplicateOf({...task, title: title.trim() || task.title, description})}))}>
                {t('Duplicate task')}
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), copyLink())}>
                {t('Copy link to task')}
              </button>
              <button type="button" role="menuitem" className="menu-item danger" disabled={!canWrite} onClick={() => (setMenu(false), setDeleting(true))}>
                {t('Delete task')}
              </button>
            </MenuPopover>
          )}
        </div>
      </Header>
      <div className="tasks-body task-form">
        {isPending && <p className="muted">{t('Loading…')}</p>}
        {!isPending &&
          !task &&
          (seen.current === id ? (
            <div className="task-gone" role="status">
              <p>{t('This task has been deleted')}</p>
              <button type="button" className="btn" onClick={() => showTasks({kind: 'list', tab: 'assigned'})}>
                {t('Tasks')}
              </button>
            </div>
          ) : (
            <p className="muted">{t('No tasks')}</p>
          ))}
        {task && (
          <>
            {/* J49: a read seat reads the task; only its comments are its to write. */}
            <fieldset className="task-fields" disabled={!canWrite}>
              <div className="task-view-title">
                <StatusToggle task={task} />
                <textarea
                  className="task-title-input"
                  rows={1}
                  aria-label={t('Task title')}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title.trim() && title !== task.title && void save({title: title.trim()})}
                />
              </div>
              <textarea
                className="input task-description"
                rows={6}
                placeholder={t('Add description')}
                aria-label={t('Add description')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => description !== (task.description ?? '') && void save({description})}
              />
              <label className="task-label">{t('Target')}</label>
              <TargetField target={task.target ? {id: task.target._ref, type: task.targetType ?? ''} : null} onChange={(next) => void save({target: next})} open />
              <label className="task-label" htmlFor={`${ids}-assignee`}>
                {t('Assign to')}
              </label>
              <AssigneeField id={`${ids}-assignee`} value={task.assignee ?? null} onChange={(assignee) => void save({assignee})} />
              <label className="task-label" htmlFor={`${ids}-due`}>
                {t('Deadline')}
              </label>
              <DateTimeInput id={`${ids}-due`} dateOnly value={task.dueAt ?? undefined} onChange={(v) => void save({dueAt: (v as string | undefined) ?? null})} placeholder={DATE_HINT} calendarLabel={t('Open calendar')} />
            </fieldset>
            <TaskActivity key={task._id} task={task} />
          </>
        )}
      </div>
      {deleting && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDeleting(false)}>
          <DialogBox className="dialog confirm-dialog" aria-modal="true" aria-label={t('Delete this task?')} onClose={() => setDeleting(false)}>
            <header>
              <h2>{t('Delete this task?')}</h2>
              <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={() => setDeleting(false)}>
                <Close />
              </button>
            </header>
            <div className="dialog-body">
              <p>{t('Once deleted, a task cannot be recovered.')}</p>
            </div>
            <footer className="dialog-actions">
              <button type="button" className="btn" onClick={() => setDeleting(false)}>
                {t('Cancel')}
              </button>
              <button type="button" className="btn danger" onClick={() => void remove()}>
                {t('Delete')}
              </button>
            </footer>
          </DialogBox>
        </div>
      )}
    </>
  )
}
