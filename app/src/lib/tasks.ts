import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import {currentEditor} from '../server/auth'

// J66, Sanity's Tasks. A task is a document of the schemaless type `studioTask` in the
// editor's own dataset (Barkpark's ruling, 2026-10-09: not Barkpark's `task` type or
// /v1/tasks, so nothing reaches bp's board, its GitHub mirror or its crons), kept out of
// the desk because no schema declares it, as comments are (lib/comments.ts). `state`
// is open or done (`status` is Barkpark's own draft/published word). Who created it is
// stamped here on the server from the signed-in editor, never sent by the page.

import {COMMENT_TYPE} from './comment-threads'
import {fencedChange, followers, TASK_TYPE, type Task, type TaskInput, type TaskRevision, type TaskState} from './task-activity'
import {sendBatches} from '../../../scripts/lib/batches.mjs'

export {TASK_TYPE, type Task, type TaskInput, type TaskState} from './task-activity'

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

async function write(mutations: Json[]) {
  const res = await bpFetch(`/v1/data/mutate/${dataset()}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({mutations}),
  })
  if (!res.ok) throw new Error(`Could not save the task (${res.status})`)
}

/** A patch that lands only on the revision read (Barkpark's per-op ifRevisionID): 'stale' when the task changed since. */
async function patchAt(task: Task, set: Record<string, Json>): Promise<'ok' | 'stale'> {
  const res = await bpFetch(`/v1/data/mutate/${dataset()}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({mutations: [{patch: {id: task._id, type: TASK_TYPE, ...(task._rev && {ifRevisionID: task._rev}), set}}, {publish: {id: task._id, type: TASK_TYPE}}]}),
  })
  if (res.status === 412) return 'stale'
  if (!res.ok) throw new Error(`Could not save the task (${res.status})`)
  return 'ok'
}

const fetchTasks = createServerFn({method: 'GET'}).handler(async () => {
  const res = await bpFetch(`/v1/data/query/${dataset()}/${TASK_TYPE}?perspective=drafts&limit=500&order=_createdAt:desc`)
  if (!res.ok) throw new Error(`Could not load the tasks (${res.status})`)
  const docs = (
    (await res.json()) as {
      result: {documents: (Task & {_publishedId: string})[]}
    }
  ).result.documents
  // A task still being written (Sanity's draft) is sent to its author only.
  const me = currentEditor()?.email ?? null
  return docs
    .filter((task) => task.state !== 'draft' || (task.createdBy ?? null) === me)
    .map(({_publishedId, ...task}) => ({
      ...task,
      _id: _publishedId,
    })) as unknown as Json
})

/** Every task in the dataset (a team's few hundred); the panel's tabs filter them. */
export const tasksQuery = queryOptions({
  queryKey: ['tasks'],
  staleTime: 10_000,
  queryFn: async () => (await fetchTasks()) as unknown as Task[],
})

export const createTask = createServerFn({method: 'POST'})
  .validator((d: TaskInput & {id: string; draft?: boolean}) => d)
  .handler(async ({data}) => {
    const title = data.title.trim()
    if (!title) throw new Error('Title is required')
    const me = currentEditor()?.email ?? null
    const doc = {
      title,
      description: data.description?.trim() || '',
      target: data.target ? {_type: 'reference', _ref: data.target.id} : null,
      targetType: data.target?.type ?? null,
      assignee: data.assignee ?? null,
      dueAt: data.dueAt || null,
      subscribers: followers(me, data.assignee),
      state: 'open',
      createdBy: me,
      createdAt: new Date().toISOString(),
    }
    // `draft`: the task was kept as a draft while it was written (saveTaskDraft): it becomes the task.
    await write([data.draft ? {patch: {id: data.id, type: TASK_TYPE, set: doc}} : {create: {_id: data.id, _type: TASK_TYPE, ...doc}}, {publish: {id: data.id, type: TASK_TYPE}}])
    return {id: data.id}
  })

/**
 * Sanity keeps a task that is being written as a draft until "Create Task": closing the
 * sidebar does not lose it, and its author finds it under Drafts. Ours is the same
 * document with `state: 'draft'` (`exists`: it was saved before, so this is a patch).
 */
export const saveTaskDraft = createServerFn({method: 'POST'})
  .validator((d: TaskInput & {id: string; exists: boolean}) => d)
  .handler(async ({data}) => {
    const fields = {
      title: data.title,
      description: data.description ?? '',
      target: data.target ? {_type: 'reference', _ref: data.target.id} : null,
      targetType: data.target?.type ?? null,
      assignee: data.assignee ?? null,
      dueAt: data.dueAt || null,
    }
    const fresh = {_id: data.id, _type: TASK_TYPE, ...fields, subscribers: [], state: 'draft', createdBy: currentEditor()?.email ?? null, createdAt: new Date().toISOString()}
    await write([data.exists ? {patch: {id: data.id, type: TASK_TYPE, set: fields}} : {create: fresh}, {publish: {id: data.id, type: TASK_TYPE}}])
    return {id: data.id}
  })

/** Change a task: its state (Sanity's status toggle), or a field of the open task. */
export const updateTask = createServerFn({method: 'POST'})
  .validator(
    (d: {
      id: string
      set: Partial<Omit<TaskInput, 'target'>> & {
        state?: TaskState
        target?: {id: string; type: string} | null
      }
    }) => d,
  )
  .handler(async ({data}) => {
    const {target, ...rest} = data.set
    const set: Record<string, Json> = {...(rest as Record<string, Json>)}
    if (target !== undefined)
      Object.assign(set, {
        target: target ? {_type: 'reference', _ref: target.id} : null,
        targetType: target?.type ?? null,
      })
    // Whoever changes a task follows it (Sanity: "When you create, modify, or comment on a
    // task you will be subscribed automatically"), and so does a new assignee. The followers
    // are the task's own as read here, not the page's copy, and the write is fenced on that
    // read: two editors changing it at once both stay followers.
    const me = currentEditor()?.email
    const task = await fencedChange(() => readTask(data.id), (now) => patchAt(now, {...set, subscribers: followers(...(now.subscribers ?? []), me, data.set.assignee)}))
    if (!task) throw new Error('Could not save the task (404)')
    return {ok: true}
  })

async function readTask(id: string): Promise<Task | null> {
  const res = await bpFetch(`/v1/data/doc/${dataset()}/${TASK_TYPE}/${encodeURIComponent(id)}?perspective=drafts`, {}, undefined, {fresh: true})
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Could not load the task (${res.status})`)
  return ((await res.json()) as {result: Task}).result
}

/**
 * Follow a task or stop following it (Sanity's Subscribe / Unsubscribe), and follow it by
 * commenting: `add` is whoever a comment mentions. Read fresh and written only when the
 * list changes, so a comment by a follower writes nothing (and adds no history row).
 */
export const followTask = createServerFn({method: 'POST'})
  .validator((d: {id: string; follow: boolean; add?: string[]}) => d)
  .handler(async ({data}) => {
    const me = currentEditor()?.email ?? null
    const next = (was: string[]) => (data.follow ? followers(...was, me, ...(data.add ?? [])) : was.filter((e) => e !== me))
    const task = await fencedChange(
      () => readTask(data.id),
      async (now) => {
        const was = now.subscribers ?? []
        const to = next(was)
        return to.length === was.length && to.every((e) => was.includes(e)) ? 'same' : patchAt(now, {subscribers: to})
      },
    )
    if (!task) throw new Error('Task not found (404)')
    return {subscribers: next(task.subscribers ?? [])}
  })

const HISTORY_PAGE = 100
/**
 * The task's history rows, newest first: `pages` reads of 100 (one, until "Show earlier"
 * walks past it). Who acted is the acting token's owner, as the History panel reads it.
 */
const fetchTaskHistory = createServerFn({method: 'GET'})
  .validator((d: {id: string; pages: number}) => d)
  .handler(async ({data}) => {
    const rows: TaskRevision[] = []
    let more = false
    for (let page = 0; page < Math.min(Math.max(data.pages, 1), 10); page++) {
      const res = await bpFetch(`/v1/data/history/${dataset()}/${TASK_TYPE}/${encodeURIComponent(data.id)}?limit=${HISTORY_PAGE}&offset=${page * HISTORY_PAGE}`)
      if (!res.ok) throw new Error(`Could not load the activity (${res.status})`)
      const {revisions, next_offset} = (await res.json()) as {revisions: {id: string; action: string; status: 'draft' | 'published'; timestamp: string; rev?: string; actor_id?: string; actor_label?: string | null}[]; next_offset?: number | null}
      rows.push(...revisions.map((r) => ({id: r.id, action: r.action, status: r.status, timestamp: r.timestamp, rev: r.rev, actor: r.actor_label || null, actorId: r.actor_id})))
      more = next_offset != null
      if (!more) break
    }
    return {rows, more} as unknown as Json
  })

export const taskHistoryQuery = (id: string, pages = 1) =>
  queryOptions({queryKey: ['task-history', id, pages], staleTime: 5_000, queryFn: async () => (await fetchTaskHistory({data: {id, pages}})) as unknown as {rows: TaskRevision[]; more: boolean}})

/** The ids of every comment on a task, a page at a time. */
async function taskCommentIds(taskId: string): Promise<string[]> {
  const ids: string[] = []
  for (let page = 0; page < 20; page++) {
    const res = await bpFetch(`/v1/data/query/${dataset()}/${COMMENT_TYPE}?perspective=drafts&limit=500&offset=${page * 500}&filter[documentId][eq]=${encodeURIComponent(taskId)}`, {}, undefined, {fresh: true})
    if (!res.ok) throw new Error(`Could not load the comments (${res.status})`)
    const {documents, hasMore} = ((await res.json()) as {result: {documents: {_publishedId: string; documentType?: string}[]; hasMore?: boolean}}).result
    ids.push(...documents.filter((c) => c.documentType === TASK_TYPE).map((c) => c._publishedId))
    if (!hasMore || documents.length < 500) break
  }
  return ids
}

/**
 * Delete a task with its thread, in one request (all or nothing). Refused (a comment someone
 * deleted meanwhile refuses the whole batch): the task goes first, then what is left of
 * its thread one by one; a comment that stays is on no task and shows nowhere.
 */
export const deleteTask = createServerFn({method: 'POST'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    const comments = await taskCommentIds(data.id)
    const send = (part: Json[]) => bpFetch(`/v1/data/mutate/${dataset()}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mutations: part})})
    const drop = (id: string): Json => ({delete: {id, type: COMMENT_TYPE, force: true}})
    const gone: Json = {delete: {id: data.id, type: TASK_TYPE, force: true}}
    const res = comments.length ? await sendBatches([...comments.map(drop), gone], send) : null
    if (res?.ok) return {ok: true}
    await write([gone])
    for (const id of comments) await send([drop(id)]).catch(() => {})
    return {ok: true}
  })
