import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset, serviceToken} from '../server/barkpark'
import {currentEditor} from '../server/auth'
import {COMMENT_TYPE, mentionsIn, type Comment, type CommentStatus} from './comment-threads'

export {COMMENT_TYPE, threadsOf, type Comment, type CommentStatus, type Thread} from './comment-threads'

// J40, Sanity's field comments. Barkpark has no comments API yet
// (task-9629f04e364f6acd), so a comment is a document of the schemaless type
// `studioComment` in the same dataset, kept out of the desk and search because
// no schema declares it. A thread is its first comment plus the replies that
// point at it; open / resolved (`state`) lives on that first comment. The author is
// stamped here on the server from the signed-in editor, never sent by the page.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

async function write(mutations: Json[]) {
  const res = await bpFetch(`/v1/data/mutate/${dataset()}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mutations})})
  if (!res.ok) throw new Error(`Could not save the comment (${res.status})`)
}

const fetchComments = createServerFn({method: 'GET'})
  .validator((d: {documentId: string}) => d)
  .handler(async ({data}) => {
    const q = `perspective=drafts&limit=500&order=_createdAt:asc&filter[documentId][eq]=${encodeURIComponent(data.documentId)}`
    const res = await bpFetch(`/v1/data/query/${dataset()}/${COMMENT_TYPE}?${q}`)
    if (!res.ok) throw new Error(`Could not load the comments (${res.status})`)
    const docs = ((await res.json()) as {result: {documents: (Comment & {_publishedId: string})[]}}).result.documents
    return docs.map(({_publishedId, ...c}) => ({...c, _id: _publishedId})) as unknown as Json
  })

export const commentsQuery = (documentId: string) =>
  queryOptions({queryKey: ['comments', documentId], staleTime: 10_000, queryFn: async () => (await fetchComments({data: {documentId}})) as unknown as Comment[]})

export const postComment = createServerFn({method: 'POST'})
  .validator((d: {id: string; documentId: string; documentType: string; fieldPath: string; message: string; parentCommentId?: string}) => d)
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

/**
 * Who can be mentioned (J40): the workspace's people (Barkpark members that are
 * users, not tokens), by email. Read with the studio's token (listing members
 * needs it); only the emails reach the page.
 */
const fetchMentionable = createServerFn({method: 'GET'}).handler(async () => {
  const res = await bpFetch('/v1/members?limit=200', {}, serviceToken())
  if (!res.ok) throw new Error(`Could not load the users (${res.status})`)
  const {members} = (await res.json()) as {members: {identity?: string; principal_type: string; revoked?: boolean | null}[]}
  return [...new Set(members.filter((m) => m.principal_type === 'user' && !m.revoked && m.identity?.includes('@')).map((m) => m.identity!))].sort()
})
export const mentionableQuery = queryOptions({queryKey: ['mentionable'], staleTime: 5 * 60_000, queryFn: async () => (await fetchMentionable()) as string[]})
