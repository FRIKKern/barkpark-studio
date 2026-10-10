import assert from 'node:assert/strict'
import {test} from 'node:test'
import {backoff, idempotent, isTransient, withRetry} from './retry.mjs'

const res = (status, body = '') => new Response(body, {status})
// A fake clock: sleeping moves it on, so the budget is real but the test takes no time.
const clock = () => {
  let t = 0
  return {now: () => t, sleep: async (ms) => void (t += ms)}
}

test('transient: dropped connections, 502/503/504, and a 500 from a pool not up yet', () => {
  assert.ok(isTransient({error: Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_SOCKET', message: 'other side closed'}})}))
  assert.ok(isTransient({error: {code: 'ECONNRESET', message: 'read ECONNRESET'}}))
  for (const s of [502, 503, 504]) assert.ok(isTransient({status: s}))
  assert.ok(isTransient({status: 500, body: '{"error":{"code":"internal_error","message":"unknown error (DBConnection.ConnectionError)","hint":"Retry shortly"}}'}))
  assert.ok(!isTransient({status: 500, body: '{"error":{"message":"boom"}}'}))
  assert.ok(!isTransient({status: 422}))
})

test('idempotent: replace, delete, publish and set/unset patches; not create, inc or insert', () => {
  assert.ok(idempotent([{createOrReplace: {_id: 'a'}}, {delete: {id: 'a'}}, {publish: {id: 'a'}}, {discardDraft: {id: 'a'}}, {patch: {id: 'a', type: 'post', set: {x: 1}, unset: ['y']}}]))
  assert.ok(!idempotent([{create: {_id: 'a'}}]))
  assert.ok(!idempotent([{patch: {id: 'a', inc: {n: 1}}}]))
  assert.ok(!idempotent([{patch: {id: 'a', insert: {after: 'x[-1]', items: [1]}}}]))
})

test('retries a transient failure with backoff and logs each retry, then returns the answer', async () => {
  const c = clock()
  const logs = []
  const answers = [() => Promise.reject(Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_SOCKET', message: 'other side closed'}})), () => res(503), () => res(500, 'DBConnection.ConnectionError'), () => res(200, '{}')]
  const r = await withRetry(() => answers.shift()(), {label: 'POST /mutate', log: (m) => logs.push(m), ...c})
  assert.equal(r.status, 200)
  assert.equal(logs.length, 3)
  assert.match(logs[0], /POST \/mutate: UND_ERR_SOCKET; again in 1 s/)
  assert.equal(c.now(), backoff(0) + backoff(1) + backoff(2))
})

test('gives up after about a minute, with the last answer', async () => {
  const c = clock()
  const r = await withRetry(async () => res(503), {label: 'x', log: () => {}, ...c})
  assert.equal(r.status, 503)
  assert.ok(c.now() <= 60_000 && c.now() > 40_000)
})

test('a write that may not repeat is never sent twice; a plain error is not retried', async () => {
  const c = clock()
  let n = 0
  await assert.rejects(withRetry(async () => (n++, Promise.reject(new TypeError('fetch failed'))), {label: 'create', safe: false, log: () => {}, ...c}))
  assert.equal(n, 1)
  n = 0
  const r = await withRetry(async () => (n++, res(500, 'boom')), {label: 'x', log: () => {}, ...c})
  assert.equal(r.status, 500)
  assert.equal(n, 1)
})
