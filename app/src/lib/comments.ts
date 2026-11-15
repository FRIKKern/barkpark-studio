import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import {sendBatches} from '../../../scripts/lib/batches.mjs'
import {currentEditor} from '../server/auth'
import {COMMENT_TYPE, commentsOn, mentionsIn, readersMayComment, toggleReaction, type Comment, type CommentSelection, type CommentStatus, type CommentTarget} from './comment-threads'
import {writeFaultFor} from '../server/write-faults'
import {readCommentSchema} from '../server/schemas'

export {COMMENT_TYPE, threadsOf, type Comment, type CommentStatus, type Thread} from './comment-threads'

// J40, Sanity's field comments. Barkpark has no comments API yet
// (task-9629f04e364f6acd), so a comment is a document of the schemaless type
// `studioComment` in the same dataset, kept out of the desk and search because
// no schema declares it. A thread is its first comment plus the replies that
// point at it; open / resolved (`state`) lives on that first comment. The author is
// stamped here on the server from the signed-in editor, never sent by the page.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

async function write(mutations: Json[]) {
  // e2e only: a fault set for a comment this write names (server/write-faults.ts).
  const fault = writeFaultFor(mutations)
  if (fault?.kind === '500') throw new Error('Could not save the comment (500)')
  if (fault?.kind === 'hang') await new Promise((go) => setTimeout(go, fault.ms ?? 0))
  // A long thread's delete goes in batches under Barkpark's cap (scripts/lib/batches.mjs).
  const res = await sendBatches(mutations, (part) => bpFetch(`/v1/data/mutate/${dataset()}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mutations: part})}))
  if (res && !res.ok) throw new Error(`Could not save the comment (${res.status})`)
  if (fault?.kind === 'reset') throw new Error('Could not save the comment (the answer was lost)')
}

const COMMENTS_PAGE = 500
const fetchComments = createServerFn({method: 'GET'})
  .validator((d: {documentId: string; target: CommentTarget}) => d)
  .handler(async ({data}) => {
    // Page by page: one read of 500 left a doc's later threads out (200 threads of three
    // comments showed 167). Twenty pages (10,000 comments) at most.
    const docs: (Comment & {_publishedId: string})[] = []
    for (let page = 0; page < 20; page++) {
      const q = `perspective=drafts&limit=${COMMENTS_PAGE}&offset=${page * COMMENTS_PAGE}&order=_createdAt:asc&filter[documentId][eq]=${encodeURIComponent(data.documentId)}`
      const res = await bpFetch(`/v1/data/query/${dataset()}/${COMMENT_TYPE}?${q}`)
      if (!res.ok) throw new Error(`Could not load the comments (${res.status})`)
      const {documents, hasMore} = ((await res.json()) as {result: {documents: (Comment & {_publishedId: string})[]; hasMore?: boolean}}).result
      docs.push(...documents)
      if (!hasMore || documents.length < COMMENTS_PAGE) break
    }
    return commentsOn(docs, data.target).map(({_publishedId, ...c}) => ({...c, _id: _publishedId})) as unknown as Json
  })

const fetchReaderComments = createServerFn({method: 'GET'}).handler(async () => readersMayComment((await readCommentSchema()) as {readerWrites?: unknown} | undefined))

/** J49: may a read-only seat add and resolve comments here (the comment schema opts in)? */
export const readerCommentsQuery = queryOptions({queryKey: ['reader-comments'], staleTime: 5 * 60_000, queryFn: () => fetchReaderComments()})

export const commentsQuery = (documentId: string) =>
  queryOptions({queryKey: ['comments', documentId], staleTime: 10_000, queryFn: async () => (await fetchComments({data: {documentId, target: 'document'}})) as unknown as Comment[]})

/** J66: a task's thread (the comments whose target is the task). Under ['comments']: every comment frame reads it again. */
export const taskCommentsQuery = (taskId: string) =>
  queryOptions({queryKey: ['comments', 'task', taskId], staleTime: 10_000, queryFn: async () => (await fetchComments({data: {documentId: taskId, target: 'task'}})) as unknown as Comment[]})

export const postComment = createServerFn({method: 'POST'})
  .validator((d: {id: string; documentId: string; documentType: string; fieldPath: string; message: string; parentCommentId?: string; selection?: CommentSelection; contentSnapshot?: string}) => d)
  .handler(async ({data}) => {
    const message = data.message.trim()
    if (!message) throw new Error('A comment needs some text.')
    const now = new Date().toISOString()
    const doc = {
      _id: data.id,
      _type: COMMENT_TYPE,
      documentId: data.documentId,
      documentType: data.documentType,
      fieldPath: data.fieldPath,
      threadId: data.parentCommentId ?? data.id,
      ...(data.parentCommentId ? {parentCommentId: data.parentCommentId} : {state: 'open'}),
      // Sanity's inline comments: a thread on a span of body text (never a reply).
      ...(!data.parentCommentId && data.selection ? {selection: data.selection as unknown as Json, contentSnapshot: data.contentSnapshot ?? ''} : {}),
      message,
      mentions: mentionsIn(message),
      authorEmail: currentEditor()?.email ?? null,
      createdAt: now,
    }
    await write([{create: doc}, {publish: {id: data.id, type: COMMENT_TYPE}}])
    return {id: data.id}
  })

export const setThreadStatus = createServerFn({method: 'POST'})
  .validator((d: {threadId: string; status: CommentStatus}) => d)
  .handler(async ({data}) => {
    await write([{patch: {id: data.threadId, type: COMMENT_TYPE, set: {state: data.status}}}, {publish: {id: data.threadId, type: COMMENT_TYPE}}])
    return {ok: true}
  })

/**
 * The body was edited around inline comments: save each thread's span where the canvas
 * moved it, or mark its text deleted (Sanity keeps the thread and greys the quote).
 */
export const moveCommentSelections = createServerFn({method: 'POST'})
  .validator((d: {moves: {id: string; selection: CommentSelection | null; text?: string}[]}) => d)
  .handler(async ({data}) => {
    await write(
      data.moves.flatMap(({id, selection, text}): Json[] => [
        {patch: {id, type: COMMENT_TYPE, set: (selection ? {selection: selection as unknown as Json, ...(typeof text === 'string' ? {selectionText: text} : {})} : {textDeleted: true}) as Json}},
        {publish: {id, type: COMMENT_TYPE}},
      ]),
    )
    return {ok: true}
  })

/** Only the author edits or deletes a comment (Sanity's rule); the server checks. */
async function own(id: string) {
  const res = await bpFetch(`/v1/data/doc/${dataset()}/${COMMENT_TYPE}/${encodeURIComponent(id)}?perspective=drafts`)
  if (!res.ok) throw new Error(`Comment not found (${res.status})`)
  const c = ((await res.json()) as {result: Comment}).result
  if ((c.authorEmail ?? null) !== (currentEditor()?.email ?? null)) throw new Error('Only the author can change this comment.')
  return c
}

export const editComment = createServerFn({method: 'POST'})
  .validator((d: {id: string; message: string}) => d)
  .handler(async ({data}) => {
    await own(data.id)
    const message = data.message.trim()
    if (!message) throw new Error('A comment needs some text.')
    await write([{patch: {id: data.id, type: COMMENT_TYPE, set: {message, mentions: mentionsIn(message), editedAt: new Date().toISOString()}}}, {publish: {id: data.id, type: COMMENT_TYPE}}])
    return {ok: true}
  })

/** Delete one comment; deleting a thread's first comment deletes its replies too (Sanity's "Delete thread"). */
export const deleteComment = createServerFn({method: 'POST'})
  .validator((d: {id: string; replyIds: string[]}) => d)
  .handler(async ({data}) => {
    await own(data.id)
    await write([data.id, ...data.replyIds].map((id) => ({delete: {id, type: COMMENT_TYPE, force: true}})))
    return {ok: true}
  })


/** Sanity's reaction toggle: the signed-in editor adds or takes back one reaction (anyone may react). */
export const reactToComment = createServerFn({method: 'POST'})
  .validator((d: {id: string; shortName: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/doc/${dataset()}/${COMMENT_TYPE}/${encodeURIComponent(data.id)}?perspective=drafts`)
    if (!res.ok) throw new Error(`Comment not found (${res.status})`)
    const c = ((await res.json()) as {result: Comment}).result
    const reactions = toggleReaction(c.reactions, data.shortName, currentEditor()?.email ?? null)
    await write([{patch: {id: data.id, type: COMMENT_TYPE, set: {reactions}}}, {publish: {id: data.id, type: COMMENT_TYPE}}])
    return {ok: true}
  })
