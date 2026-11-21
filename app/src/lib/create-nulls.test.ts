import {test, after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {register} from 'node:module'
import {QueryClient} from '@tanstack/react-query'
// task-d5f5a94e2e1690be, the Studio half: Barkpark leaves a path empty where a create sends
// null over an initial value, and fills one it leaves out (barkpark#28091). The editor's clear
// before the first save goes as null; Duplicate sends null where the original has nothing.
// Through edits.ts against a Barkpark kept in memory (save-flow.hooks.mjs).
register('./save-flow.hooks.mjs', import.meta.url)
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})
const sent: {create?: Record<string, unknown> & {_id: string}; patch?: {id: string; set?: Record<string, unknown>; unset?: string[]}}[] = []
;(globalThis as Record<string, unknown>).saveFlowServer = {
  read: async () => null,
  fetch: async (_page: string, _url: string, init: {body: string}) => {
    const m = (JSON.parse(init.body).mutations as typeof sent)[0]!
    sent.push(m)
    const id = m.create?._id ?? m.patch!.id
    const document = {...(m.create ?? {}), ...(m.patch?.set ?? {}), _id: `drafts.${id}`, _publishedId: id, _type: 'sak', _rev: `r${sent.length}`, _updatedAt: new Date().toISOString(), _draft: true, _hasPublished: false}
    return {ok: true, status: 200, json: async () => ({transactionId: `r${sent.length}`, results: [{id, operation: m.create ? 'create' : 'update', document}]})}
  },
}
const {createBody, withCopyNulls} = await import('./create-nulls.ts')
const {copyFields} = await import('./bulk.ts')
const E = await import('./edits.ts')
after(() => E.forgetEdits())

const iv = {publisert: '$today', kind: 'nyhet', title: 'Ny', meta: {dato: '$today', sak: 'x'}}
/** As sent (JSON): undefined is left out. */
const sentAs = (body: unknown) => JSON.parse(JSON.stringify(body))

test('the create body: a null only where an initial value would land; a value, a list item and the title as the edit has them', () => {
  const start = {publisert: '2026-11-21', kind: 'nyhet', title: 'Ny', meta: {dato: '2026-11-21', sak: 'x'}}
  const edits: [string, unknown][] = [['publisert', undefined], ['meta.dato', ''], ['title', ''], ['notat', ''], ['merknad', undefined], ['links[_key=="a"].url', undefined]]
  // notat and merknad have no initial value: "" and left out, as main sends them.
  assert.deepEqual(sentAs(createBody(start, edits, iv)), {publisert: null, kind: 'nyhet', title: '', meta: {dato: null, sak: 'x'}, notat: ''})
  // Left out stays out: Barkpark's to fill.
  assert.deepEqual(createBody({kind: 'nyhet'}, [['notat', 'x']], iv), {kind: 'nyhet', notat: 'x'})
})

test('a type with no initial values: the create body is main\'s, byte for byte (a typed-then-emptied field goes as "", never null)', () => {
  const start = {title: 'T'}
  const edits: [string, unknown][] = [['notat', ''], ['merknad', undefined], ['meta', {sak: ''}], ['title', '']]
  const mains = JSON.stringify({title: '', notat: '', meta: {sak: ''}})
  for (const initial of [undefined, {}]) assert.equal(JSON.stringify(createBody(start, edits, initial)), mains)
})

test('an object cleared and then one child set: the initial-value children the start showed stay cleared', () => {
  const start = {meta: {dato: '2026-11-21', sak: 'x'}}
  assert.deepEqual(sentAs(createBody(start, [['meta', {sak: 'y'}]], iv)), {meta: {sak: 'y', dato: null}})
  // A child the start did not show (an unresolved "$today", lib/today-start) stays Barkpark's.
  assert.deepEqual(sentAs(createBody({meta: {sak: 'x'}}, [['meta', {sak: 'y'}]], iv)), {meta: {sak: 'y'}})
})

test("Duplicate: a null at each initial-value path the copy holds nothing at, the shallowest; the copy's values kept", () => {
  const iv = {publisert: '$today', kind: 'nyhet', meta: {dato: '$today'}, tags: ['a']}
  // A value the copy holds is kept, whatever its shape (a string where the schema now has an object).
  assert.deepEqual(withCopyNulls(iv, {meta: 'legacy', publisert: 'x', kind: 'k', tags: ['b']}), {meta: 'legacy', publisert: 'x', kind: 'k', tags: ['b']})
  assert.deepEqual(withCopyNulls(iv, {title: 'T', meta: {sak: 's'}, tags: []}), {title: 'T', publisert: null, kind: null, meta: {sak: 's', dato: null}, tags: []}, 'an empty list is the copy\'s value')
  assert.deepEqual(withCopyNulls(iv, {title: 'T'}), {title: 'T', publisert: null, kind: null, meta: null, tags: null})
  const full = {publisert: '2026-01-02', kind: 'notis', meta: {dato: '2026-01-02'}, tags: ['b']}
  assert.deepEqual(withCopyNulls(iv, full), full)
  assert.deepEqual(withCopyNulls(undefined, {title: 'T'}), {title: 'T'})
})

test("a new document's first edit clears a prefilled date: the create sends null; an edit to another field leaves it to Barkpark", async () => {
  const qc = new QueryClient()
  const open = async (id: string, schema: Record<string, unknown> = {kind: 'nyhet', publisert: '2026-11-21'}) => {
    E.draftNew(qc, 'sak', id, {schema})
    for (let i = 0; i < 100 && !qc.getQueryData(['doc', id]); i++) await new Promise((go) => setTimeout(go, 5))
    return qc.getQueryData<Record<string, unknown>>(['doc', id])!
  }
  const write = async (id: string, field: string, value: unknown, schema?: Record<string, unknown>) => {
    E.edit(qc, (await open(id, schema)) as never, field, value)
    E.flush(qc, id)
    await E.whenSaved(id)
  }
  await write('sak-1', 'publisert', undefined)
  const create = sent.at(-1)!.create!
  assert.ok('publisert' in create && create.publisert === null, `publisert: ${JSON.stringify(create.publisert)}`)
  assert.equal(create.kind, 'nyhet')
  await write('sak-2', 'notat', 'hei')
  assert.equal(sent.at(-1)!.create!.publisert, '2026-11-21')
  // A field with no initial value, emptied: "" as main sends it, never null.
  await write('sak-3', 'notat', '', {})
  assert.equal(sent.at(-1)!.create!.notat, '')
})

test("a start's values are never cleared: the pane Duplicate sends the bulk Duplicate's body; a {local} start's \"\" goes as \"\"", async () => {
  const qc = new QueryClient()
  const iv = {publisert: '$today', kind: 'nyhet', meta: {dato: '$today', sak: 'x'}}
  const from = {_id: 'a', _type: 'sak', _rev: 'x', _updatedAt: 'u', title: 'Orig', tekst: '', meta: {sak: 's'}, kind: 'notis'}
  const createdAs = async (id: string, start: Parameters<typeof E.createDoc>[3]) => {
    await E.createDoc(qc, 'sak', id, start)
    const {_id, _type, ...body} = sent.findLast((m) => m.create?._id === id)!.create!
    return body
  }
  // The pane's own start (DocumentPane's Duplicate), read from its source and given its fields.
  const pane = readFileSync(new URL('../components/DocumentPane.tsx', import.meta.url), 'utf8').match(/createDoc\(qc, from\._type, id, (\{[^}]*\})\)/)![1]!
  const fields = withCopyNulls(iv, copyFields(from as never, {}))
  const bulk = withCopyNulls(iv, copyFields(from as never, {}))
  assert.equal(JSON.stringify(await createdAs('dup-pane', new Function('fields', `return ${pane}`)(fields))), JSON.stringify(bulk))
  assert.equal(bulk.tekst, '')
  // A template, RefInput or IncomingReferences start: its "" is the start's, not a clear.
  assert.deepEqual(await createdAs('tpl', {local: {title: 'Mal', tekst: '', kind: 'nyhet'}}), {title: 'Mal', tekst: '', kind: 'nyhet'})
})

test('the doors, by text: both create sends ask createBody; both Duplicates send the nulls; a layout type\'s "" shows as empty', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const edits = read('./edits.ts')
  assert.equal(edits.match(/\{create: \{_id: id, _type: e\.type, \.\.\.createBody\(/g)?.length, 2, 'the save and the page-close beacon')
  assert.doesNotMatch(edits, /\{create: \{_id: id, _type: e\.type, \.\.\.applyPaths\(/)
  assert.match(read('../components/DocumentPane.tsx'), /const fields = withCopyNulls\(schema\?\.initialValues, copyFields\(from, copyRank\(qc, from\)\)\)/)
  assert.match(read('./bulk-run.ts'), /\.\.\.withCopyNulls\(ctx\.initialValues, copyFields\(from, ctx\.rank\(from\)\)\)/)
  assert.match(read('../components/BulkDialog.tsx'), /initialValues: schemaOf\(schemas, doc\._type\)\?\.initialValues,/)
  // Barkpark's layout types read a cleared field as "": the date input takes it as no value.
  assert.match(read('../components/Fields.tsx'), /case 'date':\n {6}return <DateTimeInput id=\{path\} value=\{str \|\| undefined\}/)
})
