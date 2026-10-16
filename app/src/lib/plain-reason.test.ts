import {test} from 'node:test'
import assert from 'node:assert/strict'
import {plainReason} from './plain-reason.ts'

test('server faults read as plain words; a refusal keeps its own message', () => {
  assert.equal(plainReason('internal_error'), 'Barkpark could not finish this. Try again.')
  assert.equal(plainReason('rev_mismatch'), 'Someone else changed this document at the same time. Try again.')
  assert.equal(plainReason('precondition_failed'), plainReason('rev_mismatch'))
  assert.equal(plainReason('storage_unavailable'), 'Barkpark is busy. Try again in a moment.')
  assert.equal(plainReason('validation_failed'), undefined)
  assert.equal(plainReason(undefined), undefined)
})
