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
import {followers, TASK_TYPE, type Task, type TaskInput, type TaskRevision, type TaskState} from './task-activity'
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
      subscribers?: string[]
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
    // task you will be subscribed automatically"), and so does a new assignee.
    set.subscribers = followers(...(data.subscribers ?? []), currentEditor()?.email, data.set.assignee)
    await write([{patch: {id: data.id, type: TASK_TYPE, set}}, {publish: {id: data.id, type: TASK_TYPE}}])
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
    const task = await readTask(data.id)
    if (!task) throw new Error('Task not found (404)')
    const was = task.subscribers ?? []
    const now = data.follow ? followers(...was, me, ...(data.add ?? [])) : was.filter((e) => e !== me)
    if (now.length === was.length && now.every((e) => was.includes(e))) return {subscribers: was}
    await write([{patch: {id: data.id, type: TASK_TYPE, set: {subscribers: now}}}, {publish: {id: data.id, type: TASK_TYPE}}])
    return {subscribers: now}
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

/** Delete a task and, first, its thread: no comment is left pointing at nothing. */
export const deleteTask = createServerFn({method: 'POST'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    const comments = await taskCommentIds(data.id)
    // One at a time when the batch is refused: Barkpark refuses a whole batch that names a
    // comment someone deleted meanwhile, and that one is already gone.
    const drop = (ids: string[]) => sendBatches(ids.map((id) => ({delete: {id, type: COMMENT_TYPE, force: true}})), (part: Json[]) => bpFetch(`/v1/data/mutate/${dataset()}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mutations: part})}))
    if (comments.length) {
      const res = await drop(comments)
      if (res && !res.ok) for (const id of comments) await drop([id])
    }
    await write([{delete: {id: data.id, type: TASK_TYPE, force: true}}])
    return {ok: true}
  })
