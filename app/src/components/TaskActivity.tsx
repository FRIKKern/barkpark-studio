import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {keepPreviousData, useQueries, useQuery, useQueryClient} from '@tanstack/react-query'
import {useRouter} from '@tanstack/react-router'
import {followTask, taskHistoryQuery, tasksQuery, TASK_TYPE, type Task} from '../lib/tasks'
import {activityFeed, changeKind, snapshotRows, taskChanges, type TaskChange, type TaskSnapshot} from '../lib/task-activity'
import {postComment, readerCommentsQuery, taskCommentsQuery, threadsOf} from '../lib/comments'
import {mentionsIn} from '../lib/comment-threads'
import {revisionQuery} from '../lib/history'
import {anyDocQuery, previewTitle, schemaOf, schemasQuery} from '../lib/data'
import {meQuery, useCanWrite} from '../lib/session'
import {ago, dateTitle, useLocale, useT} from '../lib/i18n'
import {useZone} from '../lib/now'
import {Composer, newId, ThreadCard, type ThreadHost} from './Comments'
import {PersonName} from './Presence'
import {toast} from './Toasts'
import {Add, Calendar, CheckmarkCircle, EditIcon, LinkIcon, UserIcon} from './icons'
import '../task-activity.css'

/**
 * J66, Sanity's task Activity: who created the task, then every later change to its
 * status, assignee, due date, target, title and description, with the task's comments
 * between them by time, and the comment box under it all.
 *
 *   changes   read back from the task's own revisions (lib/task-activity.ts): one history
 *             read, then one read per revision shown, each kept for good (a revision never
 *             changes). The newest SHOWN revisions at first; "Show earlier" reads more.
 *   comments  the documents' comment store with the task as the target (lib/comments.ts
 *             taskCommentsQuery), drawn by the same thread card and composer.
 *   live      a frame for the task or a comment reads both again (lib/live.ts).
 */
const SHOWN = 20

function useTaskChanges(task: Task) {
  const qc = useQueryClient()
  const [shown, setShown] = useState(SHOWN)
  const [pages, setPages] = useState(1)
  const history = useQuery({...taskHistoryQuery(task._id, pages), placeholderData: keepPreviousData})
  const rows = useMemo(() => snapshotRows(history.data?.rows ?? []), [history.data])
  const read = rows.slice(-shown)
  const contents = useQueries({queries: read.map((r) => revisionQuery(r.id))})
  const ready = !!history.data && contents.every((c) => !c.isPending)
  // Whole or not at all: a change read across a revision still on its way would name the wrong person.
  const last = useRef<TaskChange[]>([])
  const key = read.map((r, i) => `${r.id}:${contents[i]?.dataUpdatedAt ?? 0}`).join()
  const changes = useMemo(() => {
    if (!ready) return last.current
    const snapshots = read.flatMap((r, i): TaskSnapshot[] => (contents[i]?.data ? [{at: r.timestamp, actor: r.actor, content: contents[i]!.data!.content}] : []))
    return (last.current = taskChanges(snapshots))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the rows read and their contents
  }, [ready, key])
  // The frame that says "changed" can come before Barkpark's history has the row: ask again
  // (three times at most) until the newest row is the task's own revision.
  const tries = useRef({rev: task._rev, n: 0})
  useEffect(() => {
    if (tries.current.rev !== task._rev) tries.current = {rev: task._rev, n: 0}
    if (!task._rev || !history.data || history.isFetching || history.data.rows[0]?.rev === task._rev || tries.current.n >= 3) return
    const timer = setTimeout(() => (tries.current.n++, void qc.invalidateQueries({queryKey: ['task-history', task._id]})), 1200)
    return () => clearTimeout(timer)
  }, [task._id, task._rev, history.data, history.isFetching, qc])
  const earlier = rows.length > shown || !!history.data?.more
  const showEarlier = () => {
    if (rows.length <= shown + SHOWN && history.data?.more) setPages((p) => p + 1)
    setShown((s) => s + SHOWN)
  }
  return {changes, earlier, showEarlier, loading: !ready && !last.current.length, failed: history.isError}
}

export function TaskActivity({task}: {task: Task}) {
  const t = useT()
  const qc = useQueryClient()
  const me = useQuery(meQuery).data?.email ?? null
  const {canWrite, commentReason} = useCanWrite()
  // J49: a read seat comments where the comment schema lets it, as on a document.
  const {data: readers} = useQuery({...readerCommentsQuery, enabled: !canWrite})
  const {changes, earlier, showEarlier, loading, failed} = useTaskChanges(task)
  const {data: comments} = useQuery(taskCommentsQuery(task._id))
  const feed = useMemo(() => activityFeed(changes, threadsOf(comments ?? [])), [changes, comments])

  const following = !!me && (task.subscribers ?? []).includes(me)
  const follow = useCallback(
    async (on: boolean, add: string[] = []) => {
      try {
        const {subscribers} = await followTask({data: {id: task._id, follow: on, add}})
        qc.setQueryData<Task[]>(tasksQuery.queryKey, (all) => all?.map((x) => (x._id === task._id ? {...x, subscribers} : x)))
      } catch (e) {
        // A read seat may comment and cannot change the task: its comment stands, it just does not follow.
        if (canWrite) toast({tone: 'critical', title: t('Could not save the task'), description: (e as Error).message})
      }
    },
    [task._id, qc, canWrite, t],
  )
  // Sanity's: whoever comments follows the task, and so does everyone the comment mentions.
  const subscribers = useRef(task.subscribers ?? [])
  subscribers.current = task.subscribers ?? []
  const posted = useCallback(
    (message: string) => {
      const add = mentionsIn(message)
      if ([me, ...add].some((e) => e && !subscribers.current.includes(e))) void follow(true, add)
    },
    [me, follow],
  )
  const host = useMemo<ThreadHost>(
    () => ({
      link: (commentId) => {
        const url = new URL(location.href)
        url.searchParams.set('task', task._id)
        url.hash = `comment-${commentId}`
        return url.toString()
      },
      onPosted: posted,
    }),
    [task._id, posted],
  )
  // A comment's link: the task opens (TasksPanel), and its thread shows that comment.
  const linked = typeof location !== 'undefined' && location.hash.startsWith('#comment-') ? location.hash.slice(1) : null
  useEffect(() => {
    const el = linked ? document.getElementById(linked) : null
    if (el?.closest('.task-activity')) (el.scrollIntoView({block: 'center'}), el.setAttribute('data-linked', ''))
  }, [linked, comments])

  // One id for a comment until it is known sent: a send whose answer was lost and is tried
  // again finds the comment already there, and does not post it twice.
  const sending = useRef({id: newId(), tried: false})
  const send = async (message: string) => {
    const {id, tried} = sending.current
    const there = tried && (await qc.fetchQuery({...taskCommentsQuery(task._id), staleTime: 0})).some((c) => c._id === id)
    if (!there) {
      sending.current.tried = true
      await postComment({data: {id, documentId: task._id, documentType: TASK_TYPE, fieldPath: '', message}})
    }
    sending.current = {id: newId(), tried: false}
    posted(message)
  }
  const mayComment = canWrite || !!readers
  return (
    <section className="task-activity" aria-label={t('Activity')}>
      <header>
        <h3>{t('Activity')}</h3>
        {me && (
          <button type="button" className="btn-text" disabled={!canWrite} aria-pressed={following} onClick={() => void follow(!following)}>
            {following ? t('Unsubscribe') : t('Subscribe')}
          </button>
        )}
      </header>
      <ol className="task-feed">
        <li className="task-change" data-change="created">
          <span className="task-change-icon" aria-hidden="true"><Add /></span>
          <p>
            <b>{task.createdBy ? <PersonName who={task.createdBy} /> : t('Unknown user')}</b> {t('created this task')} <When at={task.createdAt} />
          </p>
        </li>
        {earlier && (
          <li>
            <button type="button" className="btn-text task-earlier" onClick={showEarlier}>
              {t('Show earlier')}
            </button>
          </li>
        )}
        {loading && !failed && <li className="muted" role="status">{t('Loading activity')}</li>}
        {failed && <li className="muted" role="alert">{t('Could not load the activity')}</li>}
        {feed.map((item) =>
          item.kind === 'change' ? (
            <ChangeLine key={`${item.change.field}-${item.at}`} change={item.change} />
          ) : (
            <li key={item.thread.root._id} className="task-comment">
              <ThreadCard thread={item.thread} docId={task._id} docType={TASK_TYPE} host={host} />
            </li>
          ),
        )}
      </ol>
      {mayComment ? (
        <Composer label={t('Add a comment...')} placeholder={t('Add a comment...')} onSend={send} />
      ) : (
        <p className="muted task-no-comment">{commentReason}</p>
      )}
    </section>
  )
}

function When({at}: {at: string}) {
  const locale = useLocale()
  const zone = useZone()
  return (
    <span className="muted">
      •{' '}
      <time dateTime={at} title={dateTitle(at, locale, zone, 'full')}>
        {ago(at, locale, undefined, zone, false)}
      </time>
    </span>
  )
}

/** One change, in Sanity's words (getChangeDetails): who, what, to what, when. */
function ChangeLine({change}: {change: TaskChange}) {
  const t = useT()
  const locale = useLocale()
  const kind = changeKind(change)
  const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale === 'nb-NO' ? 'nb-NO' : 'en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'})
  const words: Record<typeof kind, [ReactNode, string, ReactNode?]> = {
    status: [change.to === 'done' ? <CheckmarkCircle /> : <span className="task-circle" />, t('changed status to'), <b>{change.to === 'done' ? t('Done') : t('To Do')}</b>],
    'target-set': [<LinkIcon />, t('set target content to'), change.to && <TargetLink id={change.to} />],
    'target-removed': [<LinkIcon />, t('removed target content')],
    'due-set': [<Calendar />, t('set the due date to'), change.to && <b>{day(change.to)}</b>],
    'due-changed': [<Calendar />, t('changed the due date to'), change.to && <b>{day(change.to)}</b>],
    'due-removed': [<Calendar />, t('removed the due date')],
    assigned: [<UserIcon />, t('assigned to'), <b><PersonName who={change.to} fallback={change.to ?? ''} /></b>],
    unassigned: [<UserIcon />, t('unassigned this task')],
    description: [<EditIcon />, t('updated the task description')],
    title: [<EditIcon />, t('updated the task title')],
  }
  const [icon, text, to] = words[kind]
  return (
    <li className="task-change" data-change={kind}>
      <span className="task-change-icon" aria-hidden="true">{icon}</span>
      <p>
        <b>{change.actor ? <PersonName who={change.actor} fallback={change.actor} /> : t('Unknown user')}</b> {text} {to} <When at={change.at} />
      </p>
    </li>
  )
}

/** The target a change set, by its title; a press opens it (Sanity's intent link). */
function TargetLink({id}: {id: string}) {
  const t = useT()
  const router = useRouter()
  const {data: doc} = useQuery(anyDocQuery(id))
  const {data: schemas = []} = useQuery(schemasQuery)
  if (!doc) return <b>…</b>
  return (
    <button type="button" className="btn-text task-change-target" onClick={() => void router.navigate({href: `/structure/${doc._type};${id}`})}>
      {previewTitle(doc, schemaOf(schemas, doc._type), t)}
    </button>
  )
}
