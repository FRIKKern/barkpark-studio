import {useEffect, useId, useRef, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {createTask, deleteTask, saveTaskDraft, tasksQuery, type Task} from '../lib/tasks'
import {showTasks, type TaskStart, type TaskTarget} from '../lib/tasks-ui'
import {useT} from '../lib/i18n'
import {toast} from './Toasts'
import {MenuPopover} from './FocusScopes'
import {DateTimeInput} from './DateTimeInput'
import {Check, ChevronDown, ChevronRight} from './icons'
import {AssigneeField, DATE_HINT, Header, TargetField} from './TaskFields'

/**
 * J66, Sanity's create form, and its drafts: a task being written is kept as a draft
 * (lib/tasks.ts saveTaskDraft, a second after the last key and when the form goes away),
 * so closing the sidebar does not lose it. Its author finds it again under the header's
 * Draft menu, until "Create Task" makes it the task or Discard removes it.
 *
 *   type ──1 s──▶ saveTaskDraft (create, then patches)      Create Task ──▶ createTask {draft}
 *   close / switch ──▶ saved at once                         Discard ─────▶ deleteTask
 */
const SAVE_MS = 1000
const valuesOf = (task: Task): Required<TaskStart> => ({title: task.title, description: task.description ?? '', target: task.target ? {id: task.target._ref, type: task.targetType ?? ''} : null, assignee: task.assignee ?? null, dueAt: task.dueAt ?? ''})

export function CreateTask({target: initial, draft, from}: {target: TaskTarget | null; draft?: string; from?: TaskStart}) {
  const t = useT()
  const qc = useQueryClient()
  const ids = useId()
  const {data: tasks = []} = useQuery(tasksQuery)
  const [start] = useState<Required<TaskStart>>(() => {
    const kept = draft ? tasks.find((x) => x._id === draft) : undefined
    return kept ? valuesOf(kept) : {title: from?.title ?? '', description: from?.description ?? '', target: from ? (from.target ?? null) : initial, assignee: from?.assignee ?? null, dueAt: from?.dueAt ?? ''}
  })
  const [id, setId] = useState(() => draft ?? `task-${crypto.randomUUID()}`)
  const [value, setValue] = useState(start)
  // Something to keep or to throw away: a kept draft, a duplicate, or anything typed.
  const [touched, setTouched] = useState(!!draft || !!from)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => titleRef.current?.focus(), [])

  // The draft's saves, one after the other: the first creates it, the rest patch it.
  const now = useRef({id, value})
  now.current = {id, value}
  const exists = useRef(!!draft)
  const dirty = useRef(!!from)
  const over = useRef(false) // created or discarded: nothing more to keep
  const chain = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const save = useRef(() => chain.current)
  save.current = () => {
    clearTimeout(timer.current)
    if (!dirty.current || over.current) return chain.current
    dirty.current = false
    const {id, value} = now.current
    chain.current = chain.current
      .then(() => saveTaskDraft({data: {id, ...value, dueAt: value.dueAt || null, exists: exists.current}}))
      .then(
        () => void ((exists.current = true), qc.invalidateQueries({queryKey: tasksQuery.queryKey})),
        () => void (dirty.current = true), // kept for the next try (the next key, or leaving)
      )
    return chain.current
  }
  useEffect(() => {
    if (dirty.current) timer.current = setTimeout(() => void save.current(), SAVE_MS)
    const leaving = () => void save.current()
    addEventListener('beforeunload', leaving)
    return () => (removeEventListener('beforeunload', leaving), void save.current())
  }, [])
  const change = (next: Partial<Required<TaskStart>>) => {
    setValue((v) => ({...v, ...next}))
    setTouched(true)
    dirty.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save.current(), SAVE_MS)
  }

  const create = async () => {
    if (!value.title.trim()) return setError(t('Title is required'))
    setBusy(true)
    clearTimeout(timer.current)
    dirty.current = false // the create carries every field
    try {
      await chain.current
      await createTask({data: {id, ...value, dueAt: value.dueAt || null, draft: exists.current}})
      void qc.invalidateQueries({queryKey: tasksQuery.queryKey})
      toast({tone: 'positive', title: t('Task created')})
      if (more) {
        exists.current = false
        setId(`task-${crypto.randomUUID()}`)
        setValue((v) => ({...v, title: '', description: ''}))
        setTouched(false)
        setError(undefined)
        titleRef.current?.focus()
      } else {
        over.current = true
        showTasks({kind: 'task', id})
      }
    } catch (e) {
      dirty.current = true
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const discard = async () => {
    over.current = true
    clearTimeout(timer.current)
    await chain.current
    try {
      if (exists.current) await deleteTask({data: {id}})
    } catch (e) {
      toast({tone: 'critical', title: t('Could not save the task'), description: (e as Error).message})
    }
    void qc.invalidateQueries({queryKey: tasksQuery.queryKey})
    showTasks({kind: 'list', tab: 'assigned'})
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
          <h2>{t('Create')}</h2>
        </nav>
        <DraftsMenu drafts={tasks.filter((x) => x.state === 'draft' && x._id !== id)} current={id} />
      </Header>
      <form className="tasks-body task-form" onSubmit={(e) => (e.preventDefault(), void create())}>
        <textarea ref={titleRef} className="task-title-input" rows={1} placeholder={t('Task title')} aria-label={t('Task title')} value={value.title} onChange={(e) => (change({title: e.target.value}), setError(undefined))} />
        <textarea className="input task-description" rows={9} placeholder={t('Add description')} aria-label={t('Add description')} value={value.description} onChange={(e) => change({description: e.target.value})} />
        <label className="task-label">{t('Target')}</label>
        <TargetField target={value.target} onChange={(target) => change({target})} />
        <label className="task-label" htmlFor={`${ids}-assignee`}>
          {t('Assign to')}
        </label>
        <AssigneeField id={`${ids}-assignee`} value={value.assignee} onChange={(assignee) => change({assignee})} />
        <label className="task-label" htmlFor={`${ids}-due`}>
          {t('Deadline')}
        </label>
        <DateTimeInput id={`${ids}-due`} dateOnly value={value.dueAt || undefined} onChange={(v) => change({dueAt: (v as string | undefined) ?? ''})} placeholder={DATE_HINT} calendarLabel={t('Open calendar')} />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="task-form-foot">
          <label className="task-more">
            <input type="checkbox" role="switch" checked={more} onChange={(e) => setMore(e.target.checked)} /> {t('Create more')}
          </label>
          {touched && (
            <button type="button" className="btn-text task-discard" disabled={busy} onClick={() => void discard()}>
              {t('Discard')}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('Create Task')}
          </button>
        </div>
      </form>
    </>
  )
}

/** Sanity's Draft menu in the create form's header: the tasks you started and have not created. */
function DraftsMenu({drafts, current}: {drafts: Task[]; current: string}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  if (!drafts.length) return null
  return (
    <div className="menu-wrap task-drafts">
      <button type="button" className="chip-btn plain" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t('Draft')} <ChevronDown />
      </button>
      {open && (
        <MenuPopover className="popover menu task-drafts-menu" aria-label={t('Drafts')} onClose={() => setOpen(false)}>
          <p className="menu-heading">{t('Drafts')}</p>
          {drafts.map((x) => (
            <button key={x._id} type="button" role="menuitem" className="menu-item" aria-current={x._id === current || undefined} onClick={() => (setOpen(false), showTasks({kind: 'create', target: null, draft: x._id}))}>
              <span>{x.title.trim() || t('Untitled')}</span>
              {x._id === current && <Check />}
            </button>
          ))}
        </MenuPopover>
      )}
    </div>
  )
}
