import {test} from 'node:test'
import assert from 'node:assert/strict'
import {seal, unseal} from '../server/session-cookie.ts'

// task-1883ba9b1ace5dcf: the session is the sealed cookie. What one server sealed, a
// restarted one (same secret, nothing in memory) opens; anything else opens to nothing.
const secret = 'a'.repeat(32)
const session = {email: 'ed@example.com', token: 'bp_login_abc', session: 'bp_login_abc', exp: 2_000_000_000}

test('a sealed session opens under the same secret, in a fresh module (a restart)', async () => {
  const cookie = seal(session, secret)
  assert.ok(!cookie.includes('ed@example.com') && !cookie.includes('bp_login_abc'), 'the cookie shows nothing of the session')
  const fresh = (await import(`../server/session-cookie.ts?restart=${Date.now()}`)) as typeof import('../server/session-cookie.ts')
  assert.deepEqual(fresh.unseal(cookie, secret), session)
})

test('a tampered, truncated, foreign or unsealed cookie opens to nothing', () => {
  const cookie = seal(session, secret)
  const [v, iv, body, tag] = cookie.split('.') as [string, string, string, string]
  const flip = (part: string) => {
    const b = Buffer.from(part, 'base64url')
    b[0]! ^= 1
    return b.toString('base64url')
  }
  for (const bad of [
    [v, iv, flip(body), tag].join('.'),
    [v, flip(iv), body, tag].join('.'),
    [v, iv, body, flip(tag)].join('.'),
    [v, iv, body, Buffer.from(tag, 'base64url').subarray(0, 8).toString('base64url')].join('.'),
    ['v0', iv, body, tag].join('.'),
    'not-a-session',
    '',
  ])
    assert.equal(unseal(bad, secret), undefined, bad)
  assert.equal(unseal(cookie, 'b'.repeat(32)), undefined, 'another secret')
})
