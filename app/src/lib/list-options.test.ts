import {test, after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {register} from 'node:module'
import {QueryClient} from '@tanstack/react-query'
// G4 (task-20bc1ba720eafef2): Sanity's options.list on a number field, as on a string. The reader
// (lib/list-options.ts), the form's rule for a value outside the list, paste, and every write the
// Studio makes for such a field, run through edits.ts against a Barkpark kept in memory
// (save-flow.hooks.mjs): the stored value is the JSON number, never the string.
register('./save-flow.hooks.mjs', import.meta.url)
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})
const sent: {create?: Record<string, unknown> & {_id: string}; patch?: {id: string; set?: Record<string, unknown>; unset?: string[]}}[] = []
;(globalThis as Record<string, unknown>).saveFlowServer = {
  read: async () => null,
  fetch: async (_page: string, _url: string, init: {body: string}) => {
    const m = (JSON.parse(init.body).mutations as typeof sent)[0]!
    sent.push(m)
    const id = m.create?._id ?? m.patch!.id
    const document = {...(m.create ?? {}), ...(m.patch?.set ?? {}), _id: `drafts.${id}`, _publishedId: id, _type: 'fieldTypes', _rev: `r${sent.length}`, _updatedAt: new Date().toISOString(), _draft: true, _hasPublished: false}
    return {ok: true, status: 200, json: async () => ({transactionId: `r${sent.length}`, results: [{id, operation: m.create ? 'create' : 'update', document}]})}
  },
}
const {hasList, listOptions, listValues, outsideList} = await import('./list-options.ts')
const {validate, errorsOf} = await import('./validation.ts')
const {fieldState} = await import('./conditions.ts')
const {unknown} = await import('./persons.fixture.ts')
const {transfer} = await import('./clipboard.ts')
const {revert} = await import('./merge.ts')
const E = await import('./edits.ts')
after(() => E.forgetEdits())

const perPage = {name: 'perPage', type: 'integer', options: {list: [3, 6]}, layout: 'radio'} as const

test('the reader: a number list keeps its numbers, 0 and 0.5 included; a string entry on a number field is bad, never coerced', () => {
  assert.deepEqual(listOptions(perPage), [{value: 3, title: '3'}, {value: 6, title: '6'}])
  assert.deepEqual(listOptions({type: 'integer', options: [{title: 'Six', value: 6}, {title: 'None', value: 0}]}), [{value: 6, title: 'Six'}, {value: 0, title: 'None'}])
  assert.deepEqual(listValues({type: 'number', options: {list: [0.5, 1.25]}}), [0.5, 1.25])
  // On an integer: "3" (a string) and 0.5 (a fraction) are drawn, disabled, and never stored.
  assert.deepEqual(listOptions({type: 'integer', options: {list: ['3', 3, 0.5]}}), [{value: '3', title: '3', bad: true}, {value: 3, title: '3'}, {value: 0.5, title: '0.5', bad: true}])
  assert.deepEqual(listValues({type: 'integer', options: {list: ['3', 3]}}), [3])
  // A string list as before: its values as written, plain ones titled with a capital.
  assert.deepEqual(listOptions({type: 'select', options: ['idea', {value: 'done', label: 'Done!'}]}), [{value: 'idea', title: 'Idea'}, {value: 'done', title: 'Done!'}])
  assert.equal(hasList(perPage), true)
  assert.equal(hasList({type: 'integer', options: {list: []}}), false, 'an empty list is a plain number input')
  assert.equal(hasList({type: 'integer'}), false)
})

test('a value outside the list: Sanity\'s "did not match any allowed values", kept as it is; 0 is a value, not empty', () => {
  assert.equal(outsideList(perPage, 4), true)
  assert.equal(outsideList(perPage, '6'), true, 'the string "6" is not the number 6')
  assert.equal(outsideList(perPage, 6), false)
  assert.equal(outsideList(perPage, undefined), false)
  assert.equal(outsideList({type: 'integer', options: [0, 3]}, 0), false)
  assert.equal(outsideList({type: 'integer', options: {list: ['3', 6]}}, '3'), true, 'a bad schema entry is not "in the list"')
  const doc = (fields: Record<string, unknown>) => ({_id: 'f', _publishedId: 'f', _type: 'fieldTypes', _draft: true, _rev: 'r', _updatedAt: '', ...fields}) as never
  const schema = {name: 'fieldTypes', title: 'Field types', fields: [perPage, {name: 'stage', type: 'select', options: ['idea', 'done']}, {name: 'zero', type: 'integer', options: [0, 3], validation: {required: true}}]} as never
  const said = (fields: Record<string, unknown>) => validate(doc(fields), schema).map((p) => `${p.path}: ${p.message}`)
  assert.deepEqual(said({perPage: 4, stage: 'x'.repeat(31), zero: 0}), ['perPage: Value "4" did not match any allowed values', `stage: Value "${'x'.repeat(30)}…" did not match any allowed values`])
  assert.deepEqual(said({perPage: 6, stage: 'idea', zero: 0}), [])
})

test('paste: a list field takes only its values, as numbers', () => {
  assert.deepEqual(transfer({sig: 'integer', value: 6} as never, perPage as never, undefined), {value: 6})
  assert.ok('why' in transfer({sig: 'integer', value: 4} as never, perPage as never, undefined))
  assert.ok('why' in transfer({sig: 'string', value: '6'} as never, perPage as never, undefined), 'text "6" never lands as a number')
})

test('every write keeps the number: the create, a patch, the draft echo, a clear, Duplicate and undo', async () => {
  const qc = new QueryClient()
  const id = 'per-page-1'
  const held = () => qc.getQueryData<Record<string, unknown>>(['doc', id])!
  E.draftNew(qc, 'fieldTypes', id, {})
  for (let i = 0; i < 100 && !qc.getQueryData(['doc', id]); i++) await new Promise((go) => setTimeout(go, 5))
  const write = async (value: unknown) => {
    E.edit(qc, held() as never, 'perPage', value)
    E.flush(qc, id)
    await E.whenSaved(id)
  }
  await write(6)
  assert.equal(sent.at(-1)!.create!.perPage, 6, 'the create')
  assert.equal(held().perPage, 6, 'the draft echo')
  await write(0)
  assert.equal(sent.at(-1)!.patch!.set!.perPage, 0, 'a patch, 0 kept as a value')
  await write(undefined)
  assert.deepEqual(sent.at(-1)!.patch!.unset, ['perPage'], 'a clear unsets')
  // Duplicate sends the copy as it is (createDoc asIs); undo puts the number back, not its text.
  await E.createDoc(qc, 'fieldTypes', 'per-page-2', {asIs: {perPage: 6}})
  assert.equal(sent.at(-1)!.create!.perPage, 6)
  assert.equal(revert(6, 3, 6), 3)
})

// What node can't render: the form. Its calls are pinned by text, so a number list that stops
// going to the list input, or a choice that goes out as its text, goes red.
test('a field the editor cannot change here: a value outside its list warns, never blocks Publish (a list that changed locks no one out)', () => {
  const list = ['idea', 'done']
  const schema = {name: 'side', title: 'Page', fields: [
    {name: 'fixed', title: 'Fixed', type: 'select', readOnly: true, options: list},
    {name: 'once', title: 'Once', type: 'select', readOnly: {field: 'once', operator: 'non_empty'}, options: list},
    {name: 'gone', title: 'Gone', type: 'select', hidden: true, options: list},
    {name: 'when', title: 'When', type: 'select', visibleWhen: {field: 'fixed', operator: 'eq', value: 'idea'}, options: list},
    {name: 'count', title: 'Count', type: 'integer', readOnly: true, options: {list: [3, 6]}},
    {name: 'box', title: 'Box', type: 'composite', readOnly: true, fields: [{name: 'inner', title: 'Inner', type: 'select', options: list}]},
    {name: 'open', title: 'Open', type: 'select', options: list},
  ]} as never
  const doc = (fields: Record<string, unknown>) => ({_id: 's', _publishedId: 's', _type: 'side', _draft: true, _rev: 'r', _updatedAt: '', ...fields}) as never
  // The pane's question with no studio config (lib/validation-shut.test.ts has the person's).
  const ask = (d: never) => validate(d, schema, undefined, undefined, (f, at) => {
    const state = fieldState('side', f, d, unknown, undefined, at)
    return state.hidden || state.readOnly
  })
  const shut = ask(doc({fixed: 'old', once: 'old', gone: 'old', when: 'old', count: 4, box: {inner: 'old'}}))
  assert.deepEqual(shut.map((p) => `${p.level} ${p.title}: ${p.message}`), [
    'warning Fixed: Value "old" did not match any allowed values',
    'warning Once: Value "old" did not match any allowed values',
    'warning Gone: Value "old" did not match any allowed values',
    'warning When: Value "old" did not match any allowed values',
    'warning Count: Value "4" did not match any allowed values',
    'warning Inner: Value "old" did not match any allowed values',
  ])
  assert.deepEqual(errorsOf(shut), [], 'Publish is not blocked')
  // The field the editor can change stays Sanity's error, and blocks.
  assert.deepEqual(errorsOf(ask(doc({open: 'old'}))).map((p) => p.path), ['open'])
})

test('the form, by text: a number with a list draws the list input, and a choice sends the value as the list holds it', () => {
  const fields = readFileSync(new URL('../components/Fields.tsx', import.meta.url), 'utf8')
  assert.match(fields, /case 'integer':\n[^\n]*\n {6}if \(hasList\(field\)\) return <SelectInput id=\{path\} field=\{field\} value=\{value\} onChange=\{onChange\} \/>/)
  assert.match(fields, /checked=\{!o\.bad && value === o\.value\} disabled=\{o\.bad\}[^\n]*onChange=\{\(\) => onChange\(o\.value\)\}/)
  assert.match(fields, /<option key=\{i\} value=\{i\} disabled=\{o\.bad\}/, 'a bad entry in the dropdown cannot be picked')
  assert.match(fields, /onChange=\{\(e\) => onChange\(Number\(e\.target\.value\) < 0 \? undefined : options\[Number\(e\.target\.value\)\]!\.value\)\}/)
  assert.doesNotMatch(fields, /function optionsOf/, 'one reader: lib/list-options.ts')
  // A value outside the list checks no row: its Clear is still there, under the list.
  assert.match(fields, /const known = options\.some\(\(o\) => !o\.bad && o\.value === value\)[\s\S]{0,1200}\{\(horizontal \|\| !known\) && clear\}/)
  // readOnly: a list input sits in a disabled fieldset, as every type not in this list.
  const own = /if \(readOnly && !\[([^\]]*)\]\.includes\(field\.type\)\)\n {4}return \(\n {6}<fieldset className="readonly-wrap" disabled>/.exec(fields)
  assert.ok(own, 'the readOnly wrap')
  for (const type of ['select', 'number', 'integer', 'float']) assert.ok(!own[1]!.includes(`'${type}'`), `${type} is shut when readOnly`)
})
