// J40: threads from flat comments — the first comment carries open / resolved, replies point at it.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readersMayComment, threadsOf, type Comment} from './comment-threads.ts'
import {workspacePeople} from './members.ts'

const c = (id: string, extra: Partial<Comment> = {}): Comment => ({_id: id, documentId: 'post-01', documentType: 'post', fieldPath: 'title', threadId: id, message: id, authorEmail: null, createdAt: '2026-10-08T10:00:00Z', ...extra})

test('replies join their thread; status comes from the first comment', () => {
  const threads = threadsOf([c('a'), c('b', {state: 'resolved', fieldPath: 'excerpt'}), c('r1', {parentCommentId: 'a', threadId: 'a'})])
  assert.deepEqual(threads.map((t) => [t.root._id, t.status, t.replies.map((r) => r._id)]), [['a', 'open', ['r1']], ['b', 'resolved', []]])
})

test('mentions: typed after "@", inserted as @email, found and shown as chips', async () => {
  const {mentionAt, insertMention, mentionsIn, messageParts} = await import('./comment-threads.ts')
  assert.deepEqual(mentionAt('Hi @stu', 7), {start: 3, query: 'stu'})
  assert.equal(mentionAt('mail me@x', 9), null) // not after a space
  const ins = insertMention('Hi @stu', 3, 7, 'studio-editor-b@example.com')
  assert.deepEqual(ins, {text: 'Hi @studio-editor-b@example.com ', caret: 32})
  assert.deepEqual(mentionsIn(`${ins.text}and @a@b.co.`), ['studio-editor-b@example.com', 'a@b.co'])
  assert.deepEqual(messageParts('Ask @a@b.co now'), [{text: 'Ask '}, {mention: 'a@b.co'}, {text: ' now'}])
})

test('mention list: people from every page of members, not only the first', async () => {
  const pages = [
    {members: [{principal_type: 'api_token', identity: 'bp-token'}, {principal_type: 'user', identity: 'b@example.com'}], hasMore: true, nextOffset: 2},
    {members: [{principal_type: 'user', identity: 'a@example.com'}, {principal_type: 'user', identity: 'gone@example.com', revoked: true}], hasMore: false},
  ]
  assert.deepEqual(await workspacePeople(async (offset) => pages[offset / 2]!), ['a@example.com', 'b@example.com'])
})

test('J49: viewers comment only where the comment schema lets read seats create and resolve', () => {
  assert.equal(readersMayComment({readerWrites: {create: true, patchFields: ['state']}}), true)
  assert.equal(readersMayComment({reader_writes: {create: true, patchFields: ['state', 'resolvedAt']}}), true)
  assert.equal(readersMayComment({readerWrites: {create: true, patchFields: []}}), false)
  assert.equal(readersMayComment({}), false)
  assert.equal(readersMayComment(undefined), false)
})

test('inline comments: open threads on a span paint, live Points win, moved and deleted spans save', async () => {
  const {commentRangesOf, rangeMoves} = await import('./comment-threads.ts')
  const sel = (offset: number) => ({anchor: {blockId: 'p1', offset}, head: {blockId: 'p1', offset: offset + 4}})
  const threads = threadsOf([
    c('a', {fieldPath: 'body', selection: sel(0)}),
    c('b', {fieldPath: 'body', selection: sel(10)}),
    c('gone', {fieldPath: 'body', selection: sel(20), textDeleted: true}),
    c('done', {fieldPath: 'body', selection: sel(30), state: 'resolved'}),
    c('field', {fieldPath: 'body'}),
    c('other', {fieldPath: 'excerpt', selection: sel(0)}),
  ])
  const live = new Map([['b', sel(12)]])
  assert.deepEqual(commentRangesOf(threads, 'body', 'a', live), [{id: 'a', ...sel(0), active: true}, {id: 'b', ...sel(12)}])
  // b moved; a's text is gone after the canvas painted it; c was never painted, so it is left alone.
  const more = threadsOf([...threads.map((t) => t.root), c('c', {fieldPath: 'body', selection: sel(40)})])
  assert.deepEqual(rangeMoves(more, 'body', [{id: 'b', ...sel(12)}], new Set(['a', 'b'])), [{id: 'a', selection: null}, {id: 'b', selection: sel(12)}])
  assert.deepEqual(rangeMoves(more, 'body', [{id: 'a', ...sel(0)}, {id: 'b', ...sel(10)}], new Set(['a', 'b'])), [])
})
