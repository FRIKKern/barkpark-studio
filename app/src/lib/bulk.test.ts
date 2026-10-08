import {test} from 'node:test'
import assert from 'node:assert/strict'
import {bulkSummary, isWall} from './bulk.ts'

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
