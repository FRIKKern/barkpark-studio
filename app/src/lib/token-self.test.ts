import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {serviceAccess, tokenSelf} from './token-self.ts'

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
  // task-701f8a5fdb6b4d52: the seat's role here, for the user menu.
  assert.equal(tokenSelf({kind: 'session', seats: [{workspace: {slug: 'other'}, role: 'admin'}, {workspace: {slug: 'ws'}, role: 'editor'}]}, 'ws').role, 'editor')
  assert.equal(tokenSelf({kind: 'api', seat: {role: 'viewer', can: {read: true}}}, 'ws').role, 'viewer')
  assert.equal(tokenSelf({kind: 'session', user: {id: 42}, seats: [{workspace: {slug: 'ws'}}]}, 'ws').userId, '42')
})

test("task-73a9f8eafae5fbf1: the studio's own token reads only for an editor seated here", () => {
  // Signed out (no session, or a dead token): refused, whatever workspace the request names.
  assert.equal(serviceAccess(undefined), 'signed_out')
  assert.equal(serviceAccess({permissions: [], boundDataset: null, refused: true}), 'signed_out')
  // A login session seated in another workspace only, or an API token minted for another one.
  assert.equal(serviceAccess(tokenSelf({kind: 'session', seats: [{workspace: {slug: 'other'}, can: {read: true}}]}, 'ws')), 'no_seat')
  assert.equal(serviceAccess(tokenSelf({kind: 'api', permissions: ['read'], workspace: {slug: 'other'}}, 'ws')), 'no_seat')
  // Seated here, as a viewer too (the people pickers and the content model are theirs to see).
  assert.equal(serviceAccess(tokenSelf({kind: 'session', seats: [{workspace: {slug: 'ws'}, can: {read: true, write: false}}]}, 'ws')), 'ok')
  assert.equal(serviceAccess(tokenSelf({kind: 'api', permissions: ['read', 'write'], workspace: {slug: 'ws'}}, 'ws')), 'ok')
})

test("task-73a9f8eafae5fbf1: only server/barkpark.ts reads the studio's token, behind serviceToken()'s seat check", () => {
  const src = fileURLToPath(new URL('..', import.meta.url))
  const raw = /process\.env\.BARKPARK_(SERVICE_)?TOKEN|env\('BARKPARK_(SERVICE_)?TOKEN'\)|studioToken\(/
  const readers = readdirSync(src, {recursive: true, encoding: 'utf8'}).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.') && raw.test(readFileSync(join(src, f), 'utf8')))
  assert.deepEqual(readers, [join('server', 'barkpark.ts')])
})
