import {test, after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {register} from 'node:module'
import {QueryClient} from '@tanstack/react-query'
// task-b3f4ccc4f9cfe129: a fixed type's listed page with no document yet shows as a row, and
// opening it makes that page with the listed id. Its create must be the one the + button sends
// for a type: the same initial values, the same null for a field cleared before the first save
// (#1372). Through edits.ts against a Barkpark kept in memory (save-flow.hooks.mjs).
register('./save-flow.hooks.mjs', import.meta.url)
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})
const sent: {create?: Record<string, unknown> & {_id: string; _type: string}; patch?: {id: string; set?: Record<string, unknown>}}[] = []
;(globalThis as Record<string, unknown>).saveFlowServer = {
  read: async () => null,
  fetch: async (_page: string, _url: string, init: {body: string}) => {
    const m = (JSON.parse(init.body).mutations as typeof sent)[0]!
    sent.push(m)
    const id = m.create?._id ?? m.patch!.id
    const document = {...(m.create ?? {}), ...(m.patch?.set ?? {}), _id: `drafts.${id}`, _publishedId: id, _type: m.create?._type ?? 'side', _rev: `r${sent.length}`, _updatedAt: new Date().toISOString(), _draft: true, _hasPublished: false}
    return {ok: true, status: 200, json: async () => ({transactionId: `r${sent.length}`, results: [{id, operation: m.create ? 'create' : 'update', document}]})}
  },
}
const E = await import('./edits.ts')
const {choicesFor, startNew, startFixed} = await import('./templates.ts')
const {missingFixed, offers, showsMissing} = await import('./fixed-documents.ts')
after(() => E.forgetEdits())

const initialValues = {kind: 'side', ingress: 'Skriv en ingress', meta: {synlig: true}}
const fields = [{name: 'tittel', type: 'string'}, {name: 'kind', type: 'string'}, {name: 'ingress', type: 'text'}, {name: 'meta', type: 'object'}]
// Two types alike but for the list: `side` has HSO's fixed pages, `artikkel` none.
const schemas = [
  {name: 'side', title: 'Side', fields, initialValues, fixedDocuments: ['side-om-oss', 'side-hva-vi-jobber-med']},
  {name: 'artikkel', title: 'Artikkel', fields, initialValues},
] as never

test("a listed page with no document is offered, and only that: the list's missing ids, in list order", () => {
  const side = {fixedDocuments: ['side-om-oss', 'side-hva-vi-jobber-med']}
  assert.deepEqual(missingFixed(side, ['side-om-oss', 'gammel']), ['side-hva-vi-jobber-med'])
  assert.deepEqual(missingFixed(side, ['drafts.side-hva-vi-jobber-med']), ['side-om-oss'], 'a draft is a document')
  assert.deepEqual(missingFixed({}, []), [])
  assert.deepEqual(missingFixed({fixedDocuments: []}, []), [])
  assert.equal(offers(side.fixedDocuments, 'create', 'side-om-oss'), true)
  assert.equal(offers(side.fixedDocuments, 'create', 'drafts.side-om-oss'), true)
  assert.equal(offers(side.fixedDocuments, 'create', 'ny-side'), false)
  assert.equal(offers(side.fixedDocuments, 'create', ''), false, 'the + menus ask for a new id: none')
})

test('opening a listed page writes nothing; its first edit sends one create, with the listed id', async () => {
  const qc = new QueryClient()
  const before = sent.length
  await startFixed(qc, schemas, 'side', 'side-hva-vi-jobber-med')
  await new Promise((go) => setTimeout(go, 50))
  assert.equal(sent.length, before, 'no write on open')
  const doc = qc.getQueryData<Record<string, unknown>>(['doc', 'side-hva-vi-jobber-med'])!
  E.edit(qc, doc as never, 'tittel', 'Hva vi jobber med')
  E.flush(qc, 'side-hva-vi-jobber-med')
  await E.whenSaved('side-hva-vi-jobber-med')
  const writes = sent.slice(before)
  assert.equal(writes.length, 1)
  assert.equal(writes[0]!.create?._id, 'side-hva-vi-jobber-med')
  assert.equal(writes[0]!.create?._type, 'side')
})

test('no ghost rows: a missing listed page shows only on the whole plain list, for one who may create', () => {
  const plain = {canWrite: true, published: false, filtered: false, searching: false, tree: false, hasMore: false}
  assert.equal(showsMissing(plain), true)
  // Each of these can hide a page that exists, so none may show it as missing.
  for (const k of ['published', 'filtered', 'searching', 'tree', 'hasMore'] as const) assert.equal(showsMissing({...plain, [k]: true}), false, k)
  assert.equal(showsMissing({...plain, canWrite: false}), false, 'a person who may not create (the + button\'s rule)')
})

test("opening a listed page and editing it sends the create the + button sends for a type: same initial values, same null for a cleared field", async () => {
  const qc = new QueryClient()
  const createdAs = async (id: string, open: () => Promise<void>) => {
    await open()
    for (let i = 0; i < 100 && !qc.getQueryData(['doc', id]); i++) await new Promise((go) => setTimeout(go, 5))
    const doc = qc.getQueryData<Record<string, unknown>>(['doc', id])!
    E.edit(qc, doc as never, 'ingress', undefined) // cleared before the first save
    E.edit(qc, qc.getQueryData(['doc', id]) as never, 'tittel', 'Om oss')
    E.flush(qc, id)
    await E.whenSaved(id)
    // Every write for the page, in order: the create, then what each later one sets and unsets.
    const writes = sent.filter((m) => (m.create?._id ?? m.patch?.id) === id)
    const {_id, _type, ...body} = writes[0]!.create!
    return {_id, _type, body, after: writes.slice(1).map((m) => JSON.stringify({set: m.patch?.set, unset: (m.patch as {unset?: unknown})?.unset}))}
  }
  const plus = await createdAs('artikkel-1', () => startNew(qc, schemas, choicesFor(schemas, 'artikkel')[0]!, 'artikkel-1'))
  const row = await createdAs('side-om-oss', () => startFixed(qc, schemas, 'side', 'side-om-oss'))
  assert.deepEqual(row, {_id: 'side-om-oss', _type: 'side', body: plus.body, after: plus.after})
  assert.deepEqual(row.body, {kind: 'side', ingress: null, meta: {synlig: true}})
  assert.equal(row.after.length, 1, 'the title, after the create')
})

test('the pane opens a listed page through startFixed when there is no document, and the list shows the missing ones', () => {
  const pane = readFileSync(new URL('../components/DocumentPane.tsx', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.ok(pane.includes("if (fixedNew && draftQ.data === null && !viewingPublished && !pane.template) startFixed(qc, schemas, pane.type, pane.id)"))
  const list = readFileSync(new URL('../components/Structure.tsx', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.ok(list.includes("showsMissing({canWrite, published, filtered: !!filter, searching: !!query.trim(), tree: tree || !!treeParent, hasMore: !!page.hasMore}) ? missingFixed(schemaOf(schemas, type), page.docs.map((d) => d._publishedId))"))
  // canWrite there is the + button's: the same useCanWrite() the list's + reads.
  assert.ok(list.includes('const {canWrite, canPublish, createReason} = useCanWrite()'))
  assert.ok(list.includes('<MissingFixedRows type={type} ids={notCreated}'))
})
