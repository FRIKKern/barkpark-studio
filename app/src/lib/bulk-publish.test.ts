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
    {name: 'sted', title: 'Sted', type: 'reference', to: [{type: 'sted'}]},
    // task-7e422a2d785b5a17: strong references below the top level, in an object and in an array's items.
    {name: 'vert', title: 'Vert', type: 'composite', fields: [{name: 'sted', title: 'Sted', type: 'reference', to: [{type: 'sted'}]}]},
    {name: 'program', title: 'Program', type: 'arrayOf', of: {type: 'composite', title: 'Post', fields: [{name: 'sted', title: 'Sted', type: 'reference', to: [{type: 'sted'}]}]}},
  ],
  // HSO #58: the last day before the first is an error (lib/cross-rules.ts, #1373).
  crossValidations: [{name: 'slutt_etter_start', title: 'Siste dag kan ikke være før første dag', rule: {field: 'slutt', operator: 'gte', valueField: 'start'}, fields: ['slutt']}],
} as never
const draft = (id: string, fields: Record<string, unknown>) => ({_id: `drafts.${id}`, _publishedId: id, _type: 'arrangement', _rev: 'r1', _draft: true, _hasPublished: false, ...fields})
type Draft = ReturnType<typeof draft>
const who = {} as never // unknown: no role rule here asks who
/** Barkpark's documents, whole: what a fresh read gives (the pane's docQuery). A thrown one: the read fails. */
const server = new Map<string, Draft | null | Error>()
/** The documents reference fields point at (the pane's reads of them). */
const places = new Map<string, {_id: string; _hasPublished: boolean} | null | Error>([
  ['sted-pub', {_id: 'sted-pub', _hasPublished: true}],
  ['sted-ny', {_id: 'sted-ny', _hasPublished: false}],
  ['sted-borte', null],
  ['sted-feil', new Error('read 503')],
])
const answer = <V,>(v: V | Error | undefined) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? null))
const judge = (qc: QueryClient, over: Record<string, unknown> = {}) => ({
  conditions: undefined,
  schemaFor: () => schema,
  rulesFor: () => [],
  nameOf: (d: {tittel?: string; _publishedId: string}) => d.tittel || d._publishedId,
  // As qc.fetchQuery(docQuery) does: the answer lands in the doc's cache, which publish() reads.
  readDoc: (_type: string, id: string) => answer(server.get(id)).then((d) => (qc.setQueryData(['doc', id], d), d)),
  readRef: (_f: unknown, id: string) => answer(places.get(id)),
  slugsAmong: async () => new Map(),
  ...over,
})
/** Publish selected on these list rows; Barkpark holds `whole` (default: the rows themselves). */
async function run(rows: Draft[], over: Record<string, unknown> = {}, whole: (Draft | Error)[] = rows) {
  const qc = new QueryClient()
  server.clear()
  whole.forEach((d, i) => server.set(rows[i]!._publishedId, d))
  sent.length = 0
  const outcomes = await runBulk(qc, 'publish', rows as never, who, {judge: judge(qc, over) as never, at: () => {}, t: (s) => s})
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

test('publish selected judges the whole draft, read fresh, never the list row: an error in a field the list does not show holds it; a field the row leaves out is no error', async () => {
  // The list's rows are projections: the title only, or the category only.
  const rows = [draft('skjult', {tittel: 'Kurs'}), draft('kort', {kategori: 'kurs'})]
  const whole = [draft('skjult', {tittel: 'Kurs', kategori: 'foredrag'}), draft('kort', {tittel: 'Konsert', kategori: 'kurs'})]
  const {outcomes, published} = await run(rows, {}, whole)
  assert.deepEqual(outcomes, [{kind: 'held', doc: 'Kurs', reason: 'Kategori: Value "foredrag" did not match any allowed values'}, {kind: 'done'}])
  assert.deepEqual(published, ['kort'])
  // A draft that cannot be read is never judged by its row: held.
  assert.deepEqual((await run([draft('feil', {tittel: 'Kurs'})], {}, [new Error('read 503')])).outcomes, [{kind: 'held', doc: 'Kurs', reason: 'It could not be read: open it to check'}])
})

test('publish selected never publishes on unknown: a reference is judged by the pane\'s read of its target, and a target that cannot be read holds the draft', async () => {
  const at = (id: string, sted: string) => draft(id, {tittel: id, sted: {_ref: sted}})
  const {outcomes, published} = await run([at('pub', 'sted-pub'), at('ny', 'sted-ny'), at('borte', 'sted-borte'), at('feil', 'sted-feil')])
  assert.deepEqual(published, ['pub'])
  assert.deepEqual(outcomes, [
    {kind: 'done'},
    {kind: 'held', doc: 'ny', reason: 'Sted: Referenced document must be published'},
    {kind: 'held', doc: 'borte', reason: 'Sted: Referenced document must be published'},
    {kind: 'held', doc: 'feil', reason: 'A document it refers to could not be read: open it to check'},
  ])
  // The slugs ask that cannot tell leaves each publish its own ask (the footer's), never "none taken".
  assert.deepEqual((await run([draft('slug', {tittel: 'Kurs'})], {slugsAmong: () => Promise.reject(new Error('query 503'))})).published, ['slug'])
})

test('a strong reference inside an object or an array item is judged as a top-level one: the pane\'s reads give the error on its path, and Publish selected holds the draft (task-7e422a2d785b5a17)', async () => {
  const {formCheck, refsToRead} = await import('./publish-check.ts')
  const inObject = draft('vert', {tittel: 'vert', vert: {sted: {_ref: 'sted-ny'}}})
  const inItem = draft('post', {tittel: 'post', program: [{_key: 'a', sted: {_ref: 'sted-pub'}}, {_key: 'b', sted: {_ref: 'sted-borte'}}]})
  // The pane: each reference read as the pane reads it (here from the same documents), then the form's check.
  const paneErrors = (d: Draft) => {
    const byId = new Map(refsToRead(schema, d as never).map((r) => [r.id, places.get(r.id) as never]))
    return formCheck(d as never, schema, who, undefined, {target: (id) => byId.get(id)}).map((p) => [p.path, p.message])
  }
  assert.deepEqual(paneErrors(inObject), [['vert.sted', 'Referenced document must be published']])
  assert.deepEqual(paneErrors(inItem), [['program[_key=="b"].sted', 'Referenced document must be published']])
  // Publish selected: both held, named by the nested field; a nested target that cannot be read holds too.
  const unread = draft('feil', {tittel: 'feil', program: [{_key: 'a', sted: {_ref: 'sted-feil'}}]})
  const ok = draft('ok', {tittel: 'ok', vert: {sted: {_ref: 'sted-pub'}}, program: [{_key: 'a', sted: 'sted-pub'}]})
  const {outcomes, published} = await run([inObject, inItem, unread, ok])
  assert.deepEqual(published, ['ok'])
  assert.deepEqual(outcomes, [
    {kind: 'held', doc: 'vert', reason: 'Vert / Sted: Referenced document must be published'},
    {kind: 'held', doc: 'post', reason: 'Program / Sted: Referenced document must be published'},
    {kind: 'held', doc: 'feil', reason: 'A document it refers to could not be read: open it to check'},
    {kind: 'done'},
  ])
})

test('one reader: the pane and Publish selected ask lib/publish-check.ts with the same reads, and the bar sends every publish through runBulk', () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
  const pane = src('../components/DocumentPane.tsx')
  assert.match(pane, /formCheck\(doc, schemaForPane, user, studio\.form\?\.conditions, \{target: \(id\) => byId\.get\(id\), t, widthOf\}\)/)
  assert.match(pane, /const refs = useMemo\(\(\) => refsToRead\(schemaForPane, doc\), \[schemaForPane, doc\]\)\n  const targets = useQueries\(\{queries: refs\.map\(\(r\) => docQuery\(refTypesOf\(r\.field\), r\.id\)\)\}\)/)
  assert.doesNotMatch(pane, /\bvalidate\(/)
  const bar = src('../components/BulkBar.tsx')
  assert.match(bar, /await runBulk\(qc, action, picked, user, /)
  assert.match(bar, /readDoc: \(type, id\) => qc\.fetchQuery\(\{\.\.\.docQuery\(type, id\), staleTime: 0\}\),/)
  assert.match(bar, /readRef: \(f, id\) => qc\.fetchQuery\(docQuery\(refTypesOf\(f\), id\)\),/)
  assert.doesNotMatch(bar, /\b(publish|unpublish)\(qc/)
  const bulk = src('./bulk-publish.ts')
  assert.match(bulk, /const held = await publishHold\(now, who, judge, t\)/)
  assert.match(bulk, /const refs = refsToRead\(schema, doc\)/)
})
