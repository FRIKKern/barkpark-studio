// task-4ffed14fbf52dc47: whoAmI's answer (lib/me-of.ts meOf) and the person it makes (conditions.ts
// currentUserOf). A check Barkpark did not answer gives an unknown person, never nobody.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {currentUserOf, UNKNOWN} from './conditions.ts'
import {meOf, type Read} from './me-of.ts'
import {UNKNOWN_SELF, type TokenSelf} from './token-self.ts'

const editor = {email: 'e@example.com'}
const read = (self: TokenSelf | undefined, more: Partial<Read> = {}): Read => ({mode: 'account', cloud: false, editor, self, name: 'E', presenceName: 'p', editorKey: 'k', ...more})
const answered: TokenSelf = {permissions: ['read', 'write'], boundDataset: null, role: 'member', userId: 'u1'}

test('a check Barkpark did not answer: unchecked, so the person is unknown (the mutant `unchecked: false` fails here)', () => {
  const me = meOf(read(UNKNOWN_SELF))
  assert.equal(me.unchecked, true)
  assert.equal(currentUserOf(me), UNKNOWN)
  // The studio's own token (shared sign-in, nobody signed in): unknown too, not nobody.
  const shared = meOf(read(UNKNOWN_SELF, {mode: 'shared', editor: null}))
  assert.equal(shared.unchecked, true)
  assert.equal(currentUserOf(shared), UNKNOWN)
})

test('a check Barkpark answered: checked, and the person is known, or nobody', () => {
  const me = meOf(read(answered))
  assert.equal(me.unchecked, false)
  assert.deepEqual(currentUserOf(me), {id: 'u1', name: 'E', email: 'e@example.com', roles: [{name: 'editor', title: 'Editor'}]})
  const shared = meOf(read({permissions: ['read', 'write'], boundDataset: null}, {mode: 'shared', editor: null}))
  assert.equal(shared.unchecked, false)
  assert.equal(String(currentUserOf(shared)), 'Symbol(nobody)')
  // The editor's own token refused (401): the session ends, and nobody is signed in.
  const ended = meOf(read({permissions: [], boundDataset: null, refused: true}))
  assert.deepEqual([ended.unchecked, ended.email, String(currentUserOf(ended))], [false, null, 'Symbol(nobody)'])
})
