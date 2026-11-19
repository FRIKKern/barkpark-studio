// task-4ffed14fbf52dc47: what a token may do, as Barkpark says it (server/auth.ts describeToken).
// When Barkpark does not say (no answer in time, a 5xx, a dropped connection, a body not in the
// route's shape), the answer is unknown, never "no role", and the next read asks again.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {test} from 'node:test'
import {TOKEN_READ_MS} from './token-self.ts'
import {mint, unknown} from './persons.fixture.ts'

register('./describe-token.hooks.mjs', import.meta.url)
process.env.BARKPARK_URL = 'http://barkpark.test'
const {describeToken} = await import('../server/auth.ts')

const session = {kind: 'session', user: {id: 7}, seats: [{workspace: {slug: 'ws'}, role: 'admin', can: {read: true, write: true, publish: true}}]}
const json = (status: number, body: string) => () => Promise.resolve(new Response(body, {status, headers: {'content-type': 'application/json'}}))
let answer: (signal: AbortSignal) => Promise<Response> = json(200, JSON.stringify(session))
let asked = 0
globalThis.fetch = (async (_url: unknown, init?: {signal?: AbortSignal}) => (asked++, answer(init!.signal!))) as typeof fetch

/** whoAmI's person for a signed-in editor whose token Barkpark described as `self`. */
const personOf = (self: {role?: string; unknown?: boolean; permissions: string[]}) => mint({email: 'e@example.com', name: 'E', userId: '7', role: self.role ?? null, canWrite: self.permissions.includes('write'), unchecked: !!self.unknown})

test('a check Barkpark does not answer is unknown, and is asked again, whichever way it fails', async (t) => {
  const ways: [string, (signal: AbortSignal) => Promise<Response>][] = [
    ['500', json(500, '{"error":"internal"}')],
    ['502', json(502, '')],
    ['503', json(503, '{"error":"unavailable"}')],
    ['a dropped connection', () => Promise.reject(new TypeError('fetch failed'))],
    ['a body not JSON', json(200, '<html>')],
    ['a null body', json(200, 'null')],
    ['a list for a body', json(200, '[]')],
    ['a body with no kind', json(200, '{"role":"admin"}')],
  ]
  for (const [i, [way, fails]] of ways.entries()) {
    const token = `t-${i}`
    answer = fails
    const self = await describeToken(token)
    assert.equal(self.unknown, true, way)
    assert.equal(personOf(self), unknown, `${way}: the person is unknown, not someone with no role`)
    // Not kept: the next read asks Barkpark again, and its answer counts.
    answer = json(200, JSON.stringify(session))
    const before = asked
    const again = await describeToken(token)
    assert.equal(asked, before + 1, `${way}: asked again`)
    assert.equal(again.role, 'admin', way)
  }
  // No answer in time.
  t.mock.timers.enable({apis: ['setTimeout']})
  answer = (signal) => new Promise((_, no) => signal.addEventListener('abort', () => no(new Error('aborted'))))
  const late = describeToken('t-late')
  await Promise.resolve()
  t.mock.timers.tick(TOKEN_READ_MS)
  const self = await late
  assert.equal(self.unknown, true, 'no answer in time')
  assert.equal(personOf(self), unknown)
  t.mock.timers.reset()
  answer = json(200, JSON.stringify(session))
  assert.equal((await describeToken('t-late')).role, 'admin', 'asked again after a late answer')
})

test('an answer Barkpark gave is kept, and a refusal (401) still ends the session', async () => {
  answer = json(200, JSON.stringify(session))
  const before = asked
  assert.equal((await describeToken('t-ok')).role, 'admin')
  assert.equal((await describeToken('t-ok')).role, 'admin')
  assert.equal(asked, before + 1, 'kept')
  answer = json(401, '{"error":"unauthorized"}')
  assert.equal((await describeToken('t-dead')).refused, true)
})
