import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DELETE_READS, deletedPoll, deletedState} from './deleted.ts'

const del = [{action: 'delete'}, {action: 'publish'}]
const live = [{action: 'publish'}]

test('a delete is a delete; no history is a new id; an error is not deleted', () => {
  assert.equal(deletedState(del, 1, false), true)
  assert.equal(deletedState([], 1, false), false)
  assert.equal(deletedState(undefined, 0, false), undefined)
  assert.equal(deletedState(live, 1, true), false)
})

test('history without the delete yet: not known, read again, then not found', () => {
  assert.equal(deletedState(live, 1, false), undefined)
  assert.equal(deletedPoll(live, 1), 1000)
  assert.equal(deletedState(live, DELETE_READS, false), false)
  assert.equal(deletedPoll(live, DELETE_READS), false)
  assert.equal(deletedPoll(del, 1), false)
  assert.equal(deletedPoll([], 1), false)
})
