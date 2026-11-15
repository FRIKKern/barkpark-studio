import {useQuery} from '@tanstack/react-query'
import {anyDocQuery, previewTitle, schemaOf, schemasQuery} from '../../lib/data'
import {dueState, openTasks, type Resolved} from '../../lib/dashboard'
import {usePrimed} from '../../lib/prime'
import {meQuery} from '../../lib/session'
import {tasksQuery, type Task} from '../../lib/tasks'
import {showTasks} from '../../lib/tasks-ui'
import {intlTag, useLocale, useT} from '../../lib/i18n'
import {CheckmarkCircle, DocumentIcon} from '../icons'
import {loadTasksPanel} from '../Panels'
import {RowList, WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton} from './Widget'

/**
 * My tasks (J66): the open tasks assigned to the signed-in editor, the soonest deadline
 * first; a row opens the task in the Tasks sidebar. It reads what the sidebar reads
 * (lib/tasks.ts tasksQuery, one read), and a task changed anywhere reads it again (lib/live.ts).
 * With shared sign-in nobody is "me": the widget lists every open task and says so.
 */
export function TasksWidget({widget}: {widget: Extract<Resolved, {kind: 'tasks'}>}) {
  const t = useT()
  const {data: me} = useQuery(meQuery)
  const q = useQuery({...tasksQuery, refetchOnWindowFocus: true})
  const mine = !!me?.email && me.signIn !== 'shared'
  const {rows, total} = openTasks(q.data ?? [], mine ? me!.email : null, widget.limit)
  const primed = usePrimed(rows.flatMap((x) => (x.target ? [{types: null, id: x.target._ref}] : [])))
  // The config's own title stays; ours tells the two cases apart.
  const title = widget.title === 'My tasks' && !mine ? t('Open tasks') : t(widget.title)
  const open = (view: Parameters<typeof showTasks>[0]) => void loadTasksPanel().then(() => showTasks(view), () => showTasks(view))
  return (
    <WidgetFrame
      title={title}
      width={widget.width}
      rows={Math.min(widget.limit, 5)}
      testId={`dash-${widget.key}`}
      note={mine ? undefined : t('Everyone works as one identity in this studio, so every open task is listed.')}
      onRefresh={() => void q.refetch()}
      refreshing={q.isFetching && !q.isPending}
      footer={
        <button type="button" className="btn dash-more" onClick={() => open({kind: 'list', tab: 'assigned'})} onPointerEnter={loadTasksPanel} onFocus={loadTasksPanel}>
          <CheckmarkCircle /> {total > rows.length ? t('All {count} tasks', {count: total}) : t('Open Tasks')}
        </button>
      }
    >
      {q.isError ? (
        <WidgetError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : !q.data ? (
        <WidgetSkeleton rows={3} plain />
      ) : !rows.length ? (
        <WidgetEmpty title={t('No tasks')} hint={mine ? t('Tasks assigned to you show up here.') : t('Open tasks show up here.')} />
      ) : (
        <RowList label={title} className="dash-rows dash-tasks">
          {rows.map((task) => (
            <li key={task._id} data-dash-row="">
              <TaskRow task={task} primed={!task.target || primed(task.target._ref)} onOpen={() => open({kind: 'task', id: task._id, list: rows.map((x) => x._id)})} />
            </li>
          ))}
        </RowList>
      )}
    </WidgetFrame>
  )
}

function TaskRow({task, primed, onOpen}: {task: Task; primed: boolean; onOpen: () => void}) {
  const t = useT()
  const locale = useLocale()
  // The editor's own day (a deadline is a date, not a moment).
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const due = dueState(task.dueAt, today)
  const day = task.dueAt ? new Date(`${task.dueAt}T00:00:00`).toLocaleDateString(intlTag(locale), {month: 'short', day: 'numeric'}) : ''
  return (
    <button type="button" className="dash-task" data-testid="dash-task" onClick={onOpen} onPointerEnter={loadTasksPanel} onFocus={loadTasksPanel}>
      <span className="dash-task-title">{task.title}</span>
      <span className="dash-task-meta muted">
        {task.target && (
          <span className="dash-task-target">
            <DocumentIcon />
            <TargetTitle id={task.target._ref} primed={primed} />
          </span>
        )}
        {due !== 'none' && (
          <span className="dash-due" data-due={due}>
            {due === 'overdue' ? t('Overdue: {date}', {date: day}) : due === 'today' ? t('Due today') : t('Due {date}', {date: day})}
          </span>
        )}
      </span>
    </button>
  )
}

function TargetTitle({id, primed}: {id: string; primed: boolean}) {
  const t = useT()
  const {data: doc} = useQuery({...anyDocQuery(id), enabled: primed})
  const {data: schemas = []} = useQuery(schemasQuery)
  return <>{doc ? previewTitle(doc, schemaOf(schemas, doc._type), t) : doc === null ? t('Document not found') : '…'}</>
}
