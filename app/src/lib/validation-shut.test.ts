import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fieldState, type FieldConditions, type Person} from './conditions.ts'
import {roleConditions} from './conditions.fixture.ts'
import {known, unknown} from './persons.fixture.ts'
import {errorsOf, validate, type Shut} from './validation.ts'

// task-68461849a2d6f59a: a value outside its list warns, never blocks Publish, on a field this
// person cannot change here, and "cannot change" is the form's own rule (conditions.ts
// fieldState): the studio config's role callbacks count, and a shut object or array shuts what it holds.
const doc = (type: string, fields: Record<string, unknown>) => ({_id: 'd', _publishedId: 'd', _type: type, _draft: true, _rev: 'r', _updatedAt: '', ...fields}) as never
/** The pane's question (DocumentPane.tsx, pinned below): fieldState for this person and the studio config. */
const shutFor = (type: string, d: Record<string, unknown>, who: Person, rules: Record<string, FieldConditions> | undefined): Shut => (f, at) => {
  const state = fieldState(type, f, d, who, rules, at)
  return state.hidden || state.readOnly
}
const said = (problems: ReturnType<typeof validate>) => problems.map((p) => `${p.level} ${p.path}`)

test("a role's readOnly or hidden callback: the person it shuts gets a warning; the person it leaves open, Sanity's error", () => {
  const schema = {name: 'post', title: 'Post', fields: [
    {name: 'stage', title: 'Stage', type: 'select', options: ['idea', 'done']},
    {name: 'rating', title: 'Rating', type: 'integer', options: {list: [1, 2, 3]}},
  ]} as never
  const d = doc('post', {stage: 'gone', rating: 5})
  const editor = validate(d, schema, undefined, undefined, shutFor('post', d, known('editor'), roleConditions))
  assert.deepEqual(said(editor), ['warning stage', 'warning rating'])
  assert.deepEqual(errorsOf(editor), [], 'Publish is not blocked for the editor')
  // Not known yet: a field with a callback is read-only until Barkpark says who (fieldState).
  assert.deepEqual(errorsOf(validate(d, schema, undefined, undefined, shutFor('post', d, unknown, roleConditions))), [])
  assert.deepEqual(said(validate(d, schema, undefined, undefined, shutFor('post', d, known('administrator'), roleConditions))), ['error stage', 'error rating'])
})

test("a readOnly array shuts its items' fields; an object's fields are judged with the object as parent (scope 'parent')", () => {
  const kind = {name: 'kind', title: 'Kind', type: 'select', options: ['a', 'b']}
  const schema = {name: 'page', title: 'Page', fields: [
    {name: 'fixed', title: 'Fixed', type: 'array', readOnly: true, of: {type: 'composite', fields: [kind]}},
    {name: 'open', title: 'Open', type: 'array', of: {type: 'composite', fields: [kind]}},
    {name: 'box', title: 'Box', type: 'composite', fields: [
      {name: 'lock', title: 'Lock', type: 'string'},
      {name: 'inner', title: 'Inner', type: 'select', options: ['a', 'b'], readOnly: {field: 'lock', operator: 'eq', value: 'yes', scope: 'parent'}},
    ]},
  ]} as never
  const d = doc('page', {fixed: [{_key: 'k1', kind: 'old'}], open: [{_key: 'k2', kind: 'old'}], box: {lock: 'yes', inner: 'old'}})
  assert.deepEqual(said(validate(d, schema, undefined, undefined, shutFor('page', d, known('editor'), undefined))), ['warning fixed[_key=="k1"].kind', 'error open[_key=="k2"].kind', 'warning box.inner'])
})

test('the pane asks validate with the person and the studio config, through fieldState', () => {
  const pane = readFileSync(new URL('../components/DocumentPane.tsx', import.meta.url), 'utf8')
  assert.match(pane, /validate\(doc, schemaForPane, \(id\) => byId\.get\(id\), t, \(f, at\) => shutHere\(fieldState\(schemaForPane\.name, f, doc, user, studio\.form\?\.conditions, at\)\)\)/)
  assert.match(pane, /const shutHere = \(state: \{hidden: boolean; readOnly: boolean\}\) => state\.hidden \|\| state\.readOnly\n/)
  // Without the pane's question nothing is shut: Sanity's error.
  const schema = {name: 'side', title: 'Page', fields: [{name: 'fixed', title: 'Fixed', type: 'select', readOnly: true, options: ['a']}]} as never
  assert.deepEqual(said(validate(doc('side', {fixed: 'old'}), schema)), ['error fixed'])
})
