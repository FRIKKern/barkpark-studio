// task-2c8c20f6f510647f: «Publish selected» publishes only what each document's own Publish
// would. A draft with an error (a required field, a cross rule, a custom rule) is held back,
// named, with its first error, and no publish is sent for it; a warning never holds one.
// lib/bulk-publish.ts against a Barkpark kept in memory (save-flow.hooks.mjs): every mutation
// the run sends is recorded here.
import {test, after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {register} from 'node:module'
import {QueryClient} from '@tanstack/react-query'
register('./save-flow.hooks.mjs', import.meta.url)
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})

/** IndexedDB as lib/pending-edits.ts uses it (as create-refusal.test.ts has it): what this browser keeps. */
const idb = new Map<string, unknown>()
const later = <T,>(result: () => T) => {
  const req: {result?: T; onsuccess?: () => void} = {}
  queueMicrotask(() => ((req.result = result()), req.onsuccess?.()))
  return req
}
const store = {
  put: (v: unknown, k: string) => later(() => void idb.set(k, structuredClone(v))),
  delete: (k: string) => later(() => void idb.delete(k)),
  get: (k: string) => later(() => structuredClone(idb.get(k))),
  getAll: () => later(() => [...idb.values()].map((v) => structuredClone(v))),
  getAllKeys: () => later(() => [...idb.keys()]),
}
Object.assign(globalThis, {
  indexedDB: {open: () => later(() => ({transaction: () => ({objectStore: () => store})}))},
  IDBKeyRange: {bound: (lower: string, upper: string) => ({lower, upper})},
})

/** Each mutation sent, as Barkpark got it. */
const sent: Record<string, {id: string}>[] = []
;(globalThis as Record<string, unknown>).saveFlowServer = {
  read: async () => null,
  fetch: async (_page: string, _url: string, init: {body: string}) => {
    const ms = JSON.parse(init.body).mutations as Record<string, {id: string}>[]
    sent.push(...ms)
    // An edit's save lands as sent; a publish makes the published version.
    const m = ms.at(-1)! as Record<string, {id: string; set?: Record<string, unknown>; unset?: string[]}>
    const id = (m.publish ?? m.patch)!.id
    const document = m.publish
      ? {_id: id, _publishedId: id, _type: 'arrangement', _rev: 'p1', _draft: false, _hasPublished: true}
      : {...draft(id, {}), ...m.patch!.set, _rev: `r${sent.length}`, ...Object.fromEntries((m.patch!.unset ?? []).map((k) => [k, undefined]))}
    return {ok: true, status: 200, json: async () => ({transactionId: document._rev, results: [{id, operation: m.publish ? 'publish' : 'update', document}]})}
  },
}
const E = await import('./edits.ts')
E.setKeepScope('s')
after(() => E.forgetEdits())
const {runBulk} = await import('./bulk-publish.ts')
const {bulkSummary} = await import('./bulk.ts')

const schema = {
  name: 'arrangement',
  title: 'Arrangement',
  fields: [
    {name: 'tittel', title: 'Tittel', type: 'string', validation: {required: true}},
    {name: 'kategori', title: 'Kategori', type: 'select', options: {list: ['konsert', 'kurs']}},
    {name: 'start', title: 'Første dag', type: 'date'},
    {name: 'slutt', title: 'Siste dag', type: 'date'},
  ],
  // HSO #58: the last day before the first is an error (lib/cross-rules.ts, #1373).
  crossValidations: [{name: 'slutt_etter_start', title: 'Siste dag kan ikke være før første dag', rule: {field: 'slutt', operator: 'gte', valueField: 'start'}, fields: ['slutt']}],
} as never
const draft = (id: string, fields: Record<string, unknown>) => ({_id: `drafts.${id}`, _publishedId: id, _type: 'arrangement', _rev: 'r1', _draft: true, _hasPublished: false, ...fields})
const who = {} as never // unknown: no role rule here asks who
const judge = (over: Record<string, unknown> = {}) => ({
  conditions: undefined,
  schemaFor: () => schema,
  rulesFor: () => [],
  nameOf: (d: {tittel?: string; _publishedId: string}) => d.tittel || d._publishedId,
  ...over,
})
async function run(docs: ReturnType<typeof draft>[], over: Record<string, unknown> = {}) {
  const qc = new QueryClient()
  for (const d of docs) qc.setQueryData(['doc', d._publishedId], d)
  sent.length = 0
  const outcomes = await runBulk(qc, 'publish', docs as never, who, {taken: new Map(), judge: judge(over) as never, at: () => {}, t: (s) => s})
  return {outcomes, published: sent.filter((m) => m.publish).map((m) => m.publish!.id)}
}

test('publish selected: a draft with an empty required field is held, named with its first error, and no publish is sent for it; the valid one is published', async () => {
  const {outcomes, published} = await run([draft('ok', {tittel: 'Konsert i parken'}), draft('tom', {kategori: 'kurs'})])
  assert.deepEqual(published, ['ok'])
  assert.deepEqual(outcomes, [{kind: 'done'}, {kind: 'held', doc: 'tom', reason: 'Tittel: Required'}])
  const summary = bulkSummary('publish', outcomes)
  assert.equal(summary.tone, 'critical')
  assert.equal(summary.description, '1 held back by errors — tom (Tittel: Required)')
})

test('publish selected: a cross rule (last day before the first) and a custom rule (a Promise, awaited) hold as the form does; every held draft is named', async () => {
  const rules = [{path: 'tittel', validate: async (v: unknown) => (v === 'Avlyst' ? 'Avlyst er ikke en tittel' : true)}]
  const {outcomes, published} = await run(
    [draft('dato', {tittel: 'Kurs', start: '2026-12-10', slutt: '2026-12-01'}), draft('avlyst', {tittel: 'Avlyst'}), draft('ok', {tittel: 'Kurs', start: '2026-12-01', slutt: '2026-12-10'})],
    {rulesFor: () => rules},
  )
  assert.deepEqual(published, ['ok'])
  assert.deepEqual(outcomes, [
    {kind: 'held', doc: 'Kurs', reason: 'Siste dag: Siste dag kan ikke være før første dag'},
    {kind: 'held', doc: 'Avlyst', reason: 'Tittel: Avlyst er ikke en tittel'},
    {kind: 'done'},
  ])
  assert.match(bulkSummary('publish', outcomes).description!, /^2 held back by errors — Kurs \(Siste dag: .+\); Avlyst \(Tittel: Avlyst er ikke en tittel\)$/)
})

test('publish selected: a warning never holds, and the verdict is per person (#1365): a value outside the list is an error, but only a warning in a field shut to this person', async () => {
  const warns = [{path: 'tittel', level: 'warning', validate: () => 'Kort tittel'}]
  const outside = draft('liste', {tittel: 'Kurs', kategori: 'foredrag'})
  assert.deepEqual((await run([draft('varsel', {tittel: 'Kurs'})], {rulesFor: () => warns})).published, ['varsel'])
  assert.deepEqual((await run([outside])).outcomes, [{kind: 'held', doc: 'Kurs', reason: 'Kategori: Value "foredrag" did not match any allowed values'}])
  assert.deepEqual((await run([outside], {conditions: {'arrangement.kategori': {readOnly: true}}})).published, ['liste'])
})

test('publish selected judges the draft as it will go, not the list row: the latest held here (an edit the list has not seen yet)', async () => {
  const qc = new QueryClient()
  const row = draft('sen', {tittel: 'Kurs'})
  qc.setQueryData(['doc', 'sen'], draft('sen', {tittel: ''}))
  sent.length = 0
  const outcomes = await runBulk(qc, 'publish', [row] as never, who, {taken: new Map(), judge: judge() as never, at: () => {}, t: (s) => s})
  assert.deepEqual(outcomes, [{kind: 'held', doc: 'Kurs', reason: 'Tittel: Required'}])
  assert.equal(sent.length, 0)
})

test('one reader: the pane and Publish selected ask lib/publish-check.ts, and the bar sends every publish through runBulk', () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
  const pane = src('../components/DocumentPane.tsx')
  assert.match(pane, /formCheck\(doc, schemaForPane, user, studio\.form\?\.conditions, \{target: \(id\) => byId\.get\(id\), t, widthOf\}\)/)
  assert.doesNotMatch(pane, /\bvalidate\(/)
  const bar = src('../components/BulkBar.tsx')
  assert.match(bar, /await runBulk\(qc, action, picked, user, /)
  assert.doesNotMatch(bar, /\b(publish|unpublish)\(qc/)
  assert.match(src('./bulk-publish.ts'), /const held = action === 'publish' \? await publishHold\(qc, doc, who, judge\) : null/)
})
