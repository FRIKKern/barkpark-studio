// J40: threads from flat comments — the first comment carries open / resolved, replies point at it.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {threadsOf, type Comment} from './comment-threads.ts'

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
