import {test} from 'node:test'
import assert from 'node:assert/strict'
import {tokenSelf} from './token-self.ts'

test('J49: a seat that may not publish (Contributor) still writes; a member publishes; a session reads its seat here', () => {
  const contributor = tokenSelf({kind: 'api', permissions: ['read', 'write'], seat: {can: {read: true, write: true, publish: false}}}, 'ws')
  assert.deepEqual([contributor.permissions, contributor.canPublish], [['read', 'write'], false])
  assert.equal(tokenSelf({kind: 'api', permissions: ['read', 'write'], seat: {can: {read: true, write: true, publish: true}}}, 'ws').canPublish, true)
  // A Barkpark before #22762 says nothing about publish: allowed, as before.
  assert.equal(tokenSelf({kind: 'api', permissions: ['read', 'write'], seat: {can: {read: true, write: true}}}, 'ws').canPublish, true)
  const viewer = tokenSelf({kind: 'api', permissions: ['read', 'write'], seat: {can: {read: true, write: false}}}, 'ws')
  assert.deepEqual(viewer.permissions, ['read'])
  const session = tokenSelf({kind: 'session', seats: [{workspace: {slug: 'other'}, can: {read: true, write: true, publish: true}}, {workspace: {slug: 'ws'}, can: {read: true, write: true, publish: false}}]}, 'ws')
  assert.deepEqual([session.permissions, session.canPublish], [['read', 'write'], false])
})
