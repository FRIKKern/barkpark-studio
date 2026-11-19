// task-4ffed14fbf52dc47: when the who-am-I check fails or does not answer, the studio does not
// judge role rules against a person with no role: it waits, says so, and offers a retry.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {currentUserOf, fieldState, type FieldConditions} from './conditions.ts'
import {docKeyOfEntry, pendingKey} from './pending-edits.ts'
import {personCheck, SLOW_CHECK_MS} from './person-check.ts'
import {UNKNOWN_SELF} from './token-self.ts'

const me = {email: 'ada@example.com', name: 'Ada', userId: 'u1', role: 'owner', canWrite: true}
const adminsOnly: Record<string, FieldConditions> = {'post.stage': {readOnly: ({currentUser}) => !currentUser?.roles.some((r) => r.name === 'administrator')}}
const stage = {name: 'stage', type: 'string'}

test('a check Barkpark did not answer leaves the person unknown, so a role-ruled field waits', () => {
  // describeToken's answer when Barkpark fails or is late: what it may do stays as before, who it is is unknown.
  assert.equal(UNKNOWN_SELF.unknown, true)
  assert.deepEqual(UNKNOWN_SELF.permissions, ['read', 'write'])
  // whoAmI then says so (role null, unchecked): not a person with no role, whom the rule would judge.
  const unchecked = {...me, role: null, unchecked: true}
  assert.equal(currentUserOf(unchecked), undefined)
  assert.equal(fieldState('post', stage, {}, currentUserOf(unchecked), adminsOnly).readOnly, true, 'locked while unknown')
  // The retry answers: the owner may edit it.
  assert.equal(fieldState('post', stage, {}, currentUserOf(me), adminsOnly).readOnly, false)
})

test('the page says the check failed: an unchecked answer, a failed read, or none in time', () => {
  const at = (q: Partial<Parameters<typeof personCheck>[0]>) => personCheck({data: undefined, isError: false, isFetching: false, waitedMs: 0, ...q})
  assert.equal(at({data: me}), 'known')
  assert.equal(at({data: {...me, email: null}}), 'known', 'nobody signed in is an answer')
  assert.equal(at({data: {...me, unchecked: true}}), 'failed')
  assert.equal(at({data: {...me, provisional: true}, isError: true}), 'failed')
  assert.equal(at({isError: true}), 'failed')
  // Still asking: checking, until it has waited too long.
  assert.equal(at({isFetching: true, waitedMs: SLOW_CHECK_MS - 1}), 'checking')
  assert.equal(at({data: {...me, provisional: true}, isFetching: true, waitedMs: SLOW_CHECK_MS}), 'failed')
  // A retry in flight after a failure: checking again.
  assert.equal(at({data: {...me, unchecked: true}, isFetching: true, waitedMs: 0}), 'checking')
})

test("the kept edits' doc is read from this page's entry key", () => {
  assert.equal(docKeyOfEntry(pendingKey('ws|p|ds|ed|post-1', 'tab-1'), 'tab-1'), 'ws|p|ds|ed|post-1')
  assert.equal(docKeyOfEntry('ws|p|ds|ed|post-1|other', 'tab-1'), null)
})
