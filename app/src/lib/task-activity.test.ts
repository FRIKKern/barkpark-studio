// J66: a task's Activity, read back from its revisions; its duplicate; its thread's place in the comment store.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {activityFeed, changeKind, duplicateOf, fencedChange, followers, snapshotRows, taskChanges, type TaskRevision, type TaskSnapshot} from './task-activity.ts'
import {commentsOn, composerKeepsFocus, threadsOf, type Comment} from './comment-threads.ts'

const A = 'a@example.com'
const B = 'b@example.com'
const at = (minute: number, second = 0) => `2026-11-15T10:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000000Z`
const snap = (minute: number, actor: string | null, content: TaskSnapshot['content'], second = 0): TaskSnapshot => ({at: at(minute, second), actor, content})
const base = {title: 'Fix the intro', description: '', state: 'open', assignee: null, dueAt: null, target: null}

test('activity: one line per changed field, by who wrote the revision, oldest first', () => {
  const changes = taskChanges([
    snap(0, A, base),
    snap(5, B, {...base, state: 'done'}),
    snap(10, A, {...base, state: 'done', assignee: B, dueAt: '2026-12-01'}),
    snap(15, A, {...base, state: 'done', assignee: B, dueAt: '2026-12-01', subscribers: [A, B]} as TaskSnapshot['content']), // followers only: no line
    snap(20, B, {...base, state: 'done', assignee: null, dueAt: '2026-12-24', target: {_type: 'reference', _ref: 'post-05'}}),
    snap(25, B, {...base, title: 'Fix the lede', description: 'Shorter.', state: 'open', assignee: null, dueAt: null, target: null}),
  ])
  assert.deepEqual(
    changes.map((c) => [c.actor, changeKind(c), c.to, c.at]),
    [
      [B, 'status', 'done', at(5)],
      [A, 'due-set', '2026-12-01', at(10)],
      [A, 'assigned', B, at(10)],
      [B, 'due-changed', '2026-12-24', at(20)],
      [B, 'unassigned', null, at(20)],
      [B, 'target-set', 'post-05', at(20)],
      [B, 'title', 'Fix the lede', at(25)],
      [B, 'description', 'Shorter.', at(25)],
      [B, 'due-removed', null, at(25)],
      [B, 'status', 'open', at(25)],
      [B, 'target-removed', null, at(25)],
    ],
  )
})

test('activity: creation is not a change, and neither is anything written while the task was a draft', () => {
  assert.deepEqual(taskChanges([snap(0, A, base)]), [])
  const drafted = taskChanges([
    snap(0, A, {...base, title: 'F', state: 'draft'}),
    snap(1, A, {...base, title: 'Fix', state: 'draft', assignee: B}),
    snap(2, A, {...base, assignee: B}), // Create Task: the log starts here
    snap(9, B, {...base, assignee: B, state: 'done'}),
  ])
  assert.deepEqual(drafted.map((c) => [c.actor, c.field, c.to]), [[B, 'state', 'done']])
})

test('activity: one person changing one field again within two minutes is one line; another person, or later, is its own', () => {
  const changes = taskChanges([
    snap(0, A, base),
    snap(1, A, {...base, title: 'Fix the l'}),
    snap(1, A, {...base, title: 'Fix the lede'}, 40),
    snap(2, B, {...base, title: 'Fix the lede!'}),
    snap(9, B, {...base, title: 'Fix the lede.'}),
  ])
  assert.deepEqual(changes.map((c) => [c.actor, c.from, c.to, c.at]), [
    [A, 'Fix the intro', 'Fix the lede', at(1, 40)],
    [B, 'Fix the lede', 'Fix the lede!', at(2)],
    [B, 'Fix the lede!', 'Fix the lede.', at(9)],
  ])
})

test('activity: the rows read are oldest first, without deletes and without the draft row its own publish repeats', () => {
  const row = (id: string, action: string, status: 'draft' | 'published', second: number, actorId = 't1'): TaskRevision => ({id, action, status, timestamp: `2026-11-15T10:00:${String(second).padStart(2, '0')}.000000Z`, actorId})
  const rows = snapshotRows([
    row('del', 'delete', 'published', 50),
    row('p3', 'publish', 'published', 31),
    row('d3', 'create', 'draft', 31),
    row('outside', 'update', 'draft', 20, 't2'), // an API patch that published nothing: kept
    row('p1', 'publish', 'published', 1),
    row('d1', 'create', 'draft', 1),
  ])
  assert.deepEqual(rows.map((r) => r.id), ['p1', 'outside', 'p3'])
})

const c = (id: string, createdAt: string, extra: Partial<Comment> = {}): Comment => ({_id: id, documentId: 'task-1', documentType: 'studioTask', fieldPath: '', threadId: id, message: id, authorEmail: A, createdAt, ...extra})

test('activity: comments sit between the changes by time; a reply stays in its thread', () => {
  const changes = taskChanges([snap(0, A, base), snap(5, B, {...base, state: 'done'}), snap(20, A, {...base, state: 'done', assignee: B})])
  const threads = threadsOf([c('first', at(3)), c('second', at(12)), c('reply', at(30), {parentCommentId: 'first', threadId: 'first'})])
  assert.deepEqual(
    activityFeed(changes, threads).map((i) => (i.kind === 'change' ? `change:${i.change.field}` : `thread:${i.thread.root._id}+${i.thread.replies.length}`)),
    ['thread:first+1', 'change:state', 'thread:second+0', 'change:assignee'],
  )
})

test("a task's thread never shows among a document's comments, and a document's never on a task", () => {
  // Even one that names a document's id as its target.
  const all = [c('on-task', at(1)), c('stray', at(2), {documentId: 'post-05'}), c('on-doc', at(3), {documentId: 'post-05', documentType: 'post', fieldPath: 'title'})]
  assert.deepEqual(commentsOn(all, 'document').map((x) => x._id), ['on-doc'])
  assert.deepEqual(commentsOn(all, 'task').map((x) => x._id), ['on-task', 'stray'])
})

test('duplicate: the same task with "(copy)" after its title; followers once each', () => {
  assert.deepEqual(duplicateOf({title: 'Fix the intro', description: 'Shorter.', target: {_type: 'reference', _ref: 'post-05'}, targetType: 'post', assignee: B, dueAt: '2026-12-01'}), {
    title: 'Fix the intro (copy)',
    description: 'Shorter.',
    target: {id: 'post-05', type: 'post'},
    assignee: B,
    dueAt: '2026-12-01',
  })
  assert.deepEqual(duplicateOf({title: 'Bare'}), {title: 'Bare (copy)', description: '', target: null, assignee: null, dueAt: null})
  assert.deepEqual(followers(A, null, B, A, undefined), [A, B])
})

test('two editors who follow a task at the same moment are both kept (the write is fenced on the revision read, and tried again)', async () => {
  // A store as Barkpark's: a write lands only on the revision it names.
  const store = {_rev: 'r0', subscribers: [] as string[]}
  let writes = 0
  const tick = () => new Promise((go) => setTimeout(go, 1))
  const follow = (who: string) =>
    fencedChange(
      async () => (await tick(), {...store}),
      async (now) => {
        await tick()
        if (now.subscribers.includes(who)) return 'same'
        if (now._rev !== store._rev) return 'stale'
        store.subscribers = followers(...now.subscribers, who)
        store._rev = `r${++writes}`
        return 'ok'
      },
    )
  await Promise.all([follow(A), follow(B)])
  assert.deepEqual(store.subscribers.sort(), [A, B])
  // Already a follower: nothing is written (no history row for a comment by a follower).
  await follow(A)
  assert.equal(writes, 2)
  // A task that is gone answers null; one that never stops changing gives up with a reason.
  assert.equal(await fencedChange(async () => null, async () => 'ok'), null)
  await assert.rejects(fencedChange(async () => ({_rev: 'x'}), async () => 'stale', 3), /kept changing/)
})

test('after a send the composer takes focus back only from itself or from nothing, never from a field the editor went on to', () => {
  const box = {}
  const body = {}
  const title = {}
  assert.equal(composerKeepsFocus(box, box, body), true)
  assert.equal(composerKeepsFocus(body, box, body), true) // the box was disabled while sending
  assert.equal(composerKeepsFocus(null, box, body), true)
  assert.equal(composerKeepsFocus(title, box, body), false) // reply sent, Title clicked before the answer
})
