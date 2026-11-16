import {test} from 'node:test'
import assert from 'node:assert/strict'
import {bulkResultSummary, bulkSummary, isWall, onlyGroupLink, planBulk, planRow, refusedReferrers, retryIds, type BulkRow, type RowResult} from './bulk.ts'

test('bulk summary counts like LiveView and names the wall rule', () => {
  assert.deepEqual(bulkSummary('publish', [{kind: 'done'}, {kind: 'done'}]), {tone: 'positive', title: 'Published 2 of 2', description: undefined})
  assert.deepEqual(bulkSummary('unpublish', [{kind: 'done'}, {kind: 'skipped'}]), {tone: 'positive', title: 'Unpublished 1 of 2', description: '1 was not published.'})
  const r = bulkSummary('publish', [{kind: 'done'}, {kind: 'walled', reason: 'A description must be non-trivial.'}, {kind: 'walled', reason: 'other'}, {kind: 'failed', reason: 'mutate 500'}])
  assert.equal(r.tone, 'critical')
  assert.equal(r.title, 'Published 1 of 4')
  assert.equal(r.description, '2 blocked by the publish wall — A description must be non-trivial. 1 failed: mutate 500')
})

test('the wall is told apart from other refusals by its code', () => {
  assert.ok(isWall('mutate 422: {"error":{"code":"label_spine","message":"x"}}'))
  assert.ok(isWall('mutate 422: {"error":{"code":"unknown_tag"}}'))
  assert.ok(!isWall('mutate 403: {"error":{"code":"forbidden"}}'))
})

// task-22ce73ad72423b85: a bulk delete never takes a row the reference guard holds back.
const row = (id: string, draft: boolean, published: boolean): BulkRow => ({id, type: 'author', draft, published})
const editor = {canWrite: true, canPublish: true}
const ref = {from_doc_id: 'post-1', type: 'post', title: 'Referrer', via_field: 'author'}

test('bulk delete: a referenced row is held back and names who refers; the rest go', () => {
  const rows = [row('a', false, true), row('b', true, true), row('c', true, false)]
  const refs: Record<string, typeof ref[]> = {a: [], b: [ref], c: []}
  const plan = planBulk('delete', rows, editor, (id) => refs[id])
  assert.deepEqual(plan.map((s) => (s.go ? 'go' : s.why)), ['go', 'referenced', 'go'])
  assert.deepEqual(plan[1], {row: rows[1], go: false, why: 'referenced', refs: [ref]})
  // A lookup still running or failed is never "nobody refers to it".
  assert.deepEqual(planBulk('delete', rows, editor, (id) => (id === 'c' ? undefined : [])).map((s) => (s.go ? 'go' : s.why)), ['go', 'go', 'unchecked'])
})

test('bulk delete: roles as the footer Delete (Viewer none, Contributor drafts only)', () => {
  const rows = [row('pub', false, true), row('draft-only', true, false)]
  const none = () => []
  assert.deepEqual(planBulk('delete', rows, {canWrite: false, canPublish: false}, none).map((s) => (s.go ? 'go' : s.why)), ['role', 'role'])
  assert.deepEqual(planBulk('delete', rows, {canWrite: true, canPublish: false}, none).map((s) => (s.go ? 'go' : s.why)), ['role', 'go'])
})

test('bulk discard: only a draft over a published version; draft-only and published-only rows stay', () => {
  const rows = [row('both', true, true), row('draft-only', true, false), row('published-only', false, true)]
  assert.deepEqual(planBulk('discard', rows, editor).map((s) => (s.go ? 'go' : s.why)), ['go', 'never-published', 'no-changes'])
  assert.deepEqual(planBulk('duplicate', rows, editor).map((s) => s.go), [true, true, true])
})

test('the check right before a row runs: gone, published meanwhile, referenced meanwhile', () => {
  assert.equal((planRow('delete', null, [], editor, 'x') as {why: string}).why, 'gone')
  assert.equal((planRow('delete', row('x', true, true), [ref], editor) as {why: string}).why, 'referenced')
  assert.equal((planRow('delete', row('x', true, true), [], {canWrite: true, canPublish: false}) as {why: string}).why, 'role')
  assert.equal((planRow('discard', row('x', false, true), [], editor) as {why: string}).why, 'no-changes')
})

test('a retry runs failed and stopped rows only, never one done or held back', () => {
  const results = new Map<string, RowResult>([
    ['a', {state: 'done'}],
    ['b', {state: 'failed', reason: 'mutate 500'}],
    ['c', {state: 'skipped', why: 'referenced', refs: [ref]}],
    ['d', {state: 'skipped', why: 'stopped'}],
  ])
  assert.deepEqual(retryIds(results), ['b', 'd'])
  assert.deepEqual(bulkResultSummary('delete', [...results.values()]), {tone: 'critical', title: 'Deleted 1 of 4', description: '1 left alone. 1 not run. 1 failed.'})
})

test("Barkpark's referenced refusal is read for its referrers; only a translation group's link may be unlinked", () => {
  const msg = 'mutate 409: {"error":{"code":"document_referenced","message":"x","status":409,"details":{"id":"a","referrers":[{"id":"m1","type":"translation.metadata"}]}}}'
  assert.deepEqual(refusedReferrers(msg), [{id: 'm1', type: 'translation.metadata'}])
  assert.ok(onlyGroupLink(refusedReferrers(msg)))
  assert.ok(!onlyGroupLink([{type: 'translation.metadata'}, {type: 'post'}]))
  assert.ok(!onlyGroupLink(refusedReferrers('mutate 409: {"error":{"code":"document_referenced","details":{"referrers":[{"id":"m1","ty')))
  assert.equal(refusedReferrers('mutate 500: {"error":{"code":"internal_error"}}'), null)
})
