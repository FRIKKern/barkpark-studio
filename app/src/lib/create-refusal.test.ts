import {describe, test, after} from 'node:test'
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {QueryClient} from '@tanstack/react-query'
// task-8eefa46ccbe23d49: one rule for what the save queue sends again. Only what can go better
// later goes again (a 5xx, 408, 429, a conflict the queue replays); any other refusal (4xx) is
// final: one call, state refused in Barkpark's words (or one naming the status), every value
// kept (here and in this browser's store), and a createDoc rejects so its caller's toast runs.
// lib/edits.ts against a Barkpark kept in memory (save-flow.hooks.mjs), one document per case.
register('./save-flow.hooks.mjs', import.meta.url)
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})

/** IndexedDB as lib/pending-edits.ts uses it (as save-flow.test.ts has it): what this browser keeps. */
const idb = new Map<string, unknown>()
const later = <T,>(result: () => T) => {
  const req: {result?: T; onsuccess?: () => void} = {}
  queueMicrotask(() => ((req.result = result()), req.onsuccess?.()))
  return req
}
const inRange = (k: string, r?: {lower: string; upper: string}) => !r || (k >= r.lower && k <= r.upper)
const store = {
  put: (v: unknown, k: string) => later(() => void idb.set(k, structuredClone(v))),
  delete: (k: string) => later(() => void idb.delete(k)),
  get: (k: string) => later(() => structuredClone(idb.get(k))),
  getAll: (r?: {lower: string; upper: string}) => later(() => [...idb].filter(([k]) => inRange(k, r)).map(([, v]) => structuredClone(v))),
  getAllKeys: (r?: {lower: string; upper: string}) => later(() => [...idb.keys()].filter((k) => inRange(k, r))),
}
Object.assign(globalThis, {
  indexedDB: {open: () => later(() => ({transaction: () => ({objectStore: () => store})}))},
  IDBKeyRange: {bound: (lower: string, upper: string) => ({lower, upper})},
})

type Answer = {status: number; body?: unknown}
/** Each document's answers, in order; once they run out, its writes land. */
const answers = new Map<string, Answer[]>()
const calls = new Map<string, number>()
const readFails = new Set<string>()
const stored = new Map<string, Record<string, unknown>>()
const now = (id: string, fields: Record<string, unknown>, rev: string) => ({_id: `drafts.${id}`, _publishedId: id, _type: 'side', _rev: rev, _updatedAt: new Date().toISOString(), _draft: true, _hasPublished: false, ...fields})
;(globalThis as Record<string, unknown>).saveFlowServer = {
  read: async (_page: string, _type: string, id: string) => {
    if (readFails.delete(id)) throw new TypeError('fetch failed') // once
    return stored.get(id) ?? null
  },
  fetch: async (_page: string, _url: string, init: {body: string}) => {
    const m = (JSON.parse(init.body).mutations as {create?: Record<string, unknown> & {_id: string}; patch?: {id: string; set?: Record<string, unknown>}}[]).at(-1)!
    const id = m.create?._id ?? m.patch!.id
    calls.set(id, (calls.get(id) ?? 0) + 1)
    const a = answers.get(id)?.shift()
    if (a) return {ok: false, status: a.status, json: async () => a.body ?? {}}
    const doc = now(id, {...(stored.get(id) ?? {}), ...(m.create ?? {}), ...(m.patch?.set ?? {})}, `r${calls.get(id)}`)
    stored.set(id, doc)
    return {ok: true, status: 200, json: async () => ({transactionId: doc._rev, results: [{id, operation: m.create ? 'create' : 'update', document: doc}]})}
  },
}
const E = await import('./edits.ts')
E.setKeepScope('s')
after(() => E.forgetEdits())

const refusal = (code: string, message: string) => ({error: {code, message}})
const settle = (p: Promise<void>) => p.then(() => 'created', (err: Error) => `rejected: ${err.message}`)
const wait = (ms: number) => new Promise((go) => setTimeout(go, ms))
/** A time limit that keeps no test process waiting for it. */
const cap = (ms: number) => new Promise((go) => setTimeout(go, ms).unref()).then(() => 'pending')

// The three at once (each waits out the 2 s retry timer): different documents, one budget.
describe('the save queue gives up only on what cannot go better', {concurrency: true}, () => {
test('a create refused 403, 400, 422 without findings or 409 (not there when read): one call, refused, values kept, createDoc rejects', async () => {
  const qc = new QueryClient()
  const cases: [string, Answer, string][] = [
    ['c403', {status: 403, body: refusal('forbidden', 'Not allowed to write side')}, 'Not allowed to write side.'],
    ['c400', {status: 400, body: refusal('bad_request', 'Unknown mutation')}, 'Unknown mutation.'],
    ['c422', {status: 422, body: refusal('invalid_document', 'The document is not valid')}, 'The document is not valid.'],
    ['c409', {status: 409, body: refusal('conflict', 'That id is taken')}, 'That id is taken.'],
    ['c409fixed', {status: 409, body: {error: {code: 'fixed_document', message: 'no', details: {action: 'create', type: 'side'}}}}, 'side has a fixed set of documents. A new one cannot be created.'],
    ['c400bare', {status: 400}, 'Barkpark refused the change (400)'],
  ]
  for (const [id, a] of cases) answers.set(id, [a])
  const made = cases.map(([id]) => settle(E.createDoc(qc, 'side', id, {asIs: {tittel: `Ny ${id}`}})))
  const said = await Promise.race([Promise.all(made), cap(3000)])
  assert.deepEqual(said, cases.map(([, , why]) => `rejected: ${why}`))
  // No retry: a plain failure's 2 s timer would have sent each again by now.
  await wait(2100)
  for (const [id] of cases) {
    assert.equal(calls.get(id), 1, id)
    assert.equal(E.saveStateOf(id), 'refused', id)
    assert.equal(qc.getQueryData<{tittel?: string}>(['doc', id])?.tittel, `Ny ${id}`, id)
  }
})

test('an edit refused 400 without findings: one call, refused, the value kept on screen and in this browser', async () => {
  const qc = new QueryClient()
  const id = 'p400'
  stored.set(id, now(id, {tittel: 'Om oss'}, 'r0'))
  qc.setQueryData(['doc', id], stored.get(id))
  answers.set(id, [{status: 400, body: refusal('bad_request', 'Unknown field')}])
  E.edit(qc, stored.get(id) as never, 'tittel', 'Om oss nå')
  E.flush(qc, id)
  await wait(2400)
  assert.equal(calls.get(id), 1)
  assert.equal(E.saveStateOf(id), 'refused')
  assert.equal(qc.getQueryData<{tittel?: string}>(['doc', id])?.tittel, 'Om oss nå')
  const kept = [...idb].filter(([k]) => k.includes(`|${id}|`)).map(([, v]) => v) as {fields: [string, unknown][]}[]
  assert.deepEqual(kept.flatMap((k) => k.fields), [['tittel', 'Om oss nå']])
})

test('what can go better later still goes again: a 500, 408, 429, a 409 the read cannot explain, a stale rev', async () => {
  const qc = new QueryClient()
  const cases: [string, Answer][] = [
    ['r500', {status: 500, body: refusal('internal_error', 'Internal Server Error')}],
    ['r408', {status: 408}],
    ['r429', {status: 429, body: refusal('rate_limited', 'Slow down')}],
    ['r409', {status: 409, body: refusal('conflict', 'already been taken')}],
  ]
  readFails.add('r409')
  for (const [id, a] of cases) answers.set(id, [a])
  const made = cases.map(([id]) => settle(E.createDoc(qc, 'side', id, {asIs: {tittel: id}})))
  // A stale rev on an edit: read theirs, send again on it.
  const id = 'p412'
  stored.set(id, now(id, {tittel: 'Om oss'}, 'r0'))
  qc.setQueryData(['doc', id], stored.get(id))
  answers.set(id, [{status: 412, body: refusal('precondition_failed', 'document revision mismatch')}])
  E.edit(qc, stored.get(id) as never, 'tittel', 'Om oss nå')
  E.flush(qc, id)
  assert.deepEqual(await Promise.race([Promise.all(made), cap(4500)]), cases.map(() => 'created'))
  for (const [id] of cases) assert.equal(calls.get(id), 2, id)
  await E.whenSaved(id)
  assert.equal(calls.get(id), 2)
  assert.equal((stored.get(id) as {tittel?: string}).tittel, 'Om oss nå')
})
})
