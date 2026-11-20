// The studio puts an item rule's problem on the item Barkpark's finding names (task-17f1c7ca018e794c):
// the cases and Barkpark's own finding paths are in fixtures/cross-item-cases.json, made by
// running Barkpark's cross_validator.ex (scripts/field-visibility-cases.exs).
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import type {Doc, Field, Schema} from './data.ts'
import {crossProblems, ITEM_CAP} from './cross-rules.ts'
import {advisoryProblems, formPath, formPathIn, keyedAt, type Finding} from './findings.ts'

type Case = {name: string; rule: unknown; doc: Record<string, unknown>; server: string[] | 'skip'}
const {cases} = JSON.parse(readFileSync(new URL('../../../fixtures/cross-item-cases.json', import.meta.url), 'utf8')) as {cases: Case[]}
const item = (...names: string[]): Field => ({name: 'item', type: 'composite', fields: names.map((name) => ({name, title: name.toUpperCase(), type: 'string'}))}) as Field
const fields = [
  {name: 'meny', title: 'Meny', type: 'arrayOf', of: {...item('side', 'omrade', 'tittel', 'start', 'slutt'), fields: [...item('side', 'omrade', 'tittel', 'start', 'slutt').fields!, {name: 'under', title: 'Under', type: 'arrayOf', of: item('side', 'omrade')}]}},
  {name: 'innhold', title: 'Innhold', type: 'arrayOf', of: item('emneknagg', 'pilot')},
  {name: 'tittel', title: 'Tittel', type: 'string'},
  {name: 'innstillinger', title: 'Innstillinger', type: 'composite', fields: [{name: 'meny', title: 'Meny', type: 'arrayOf', of: item('side', 'omrade')}]},
] as Field[]
const schemaOf = (rule: unknown) => ({name: 't', title: 'T', fields, crossValidations: [rule]}) as unknown as Schema
const docOf = (c: Case) => ({_id: 'x', _type: 't', ...c.doc}) as unknown as Doc

test('the studio shows each item rule on the item Barkpark names (fixtures/cross-item-cases.json)', () => {
  assert.equal(cases.length, 38)
  const wrong = cases.flatMap((c) => {
    const studio = crossProblems(docOf(c), schemaOf(c.rule)).map((p) => p.path)
    // Barkpark's paths as a save names them (keyedAt); a rule Barkpark cannot evaluate is no finding.
    const want = c.server === 'skip' ? [] : keyedAt(c.server.map((path) => ({path, message: '', code: 'cross_validation'})), c.doc).map((f) => f.at ?? formPath(f.path))
    return JSON.stringify(studio) === JSON.stringify(want) ? [] : [`${c.name}: studio ${JSON.stringify(studio)}, Barkpark ${JSON.stringify(want)}`]
  })
  assert.deepEqual(wrong, [])
})

test("an each-item rule's message shows on that item, not on the list", () => {
  const c = cases.find((x) => x.name === 'meny: second item has neither')!
  const [p, ...rest] = crossProblems(docOf(c), schemaOf(c.rule))
  assert.deepEqual(rest, [])
  assert.deepEqual(p, {path: 'meny[_key=="b"].side', title: 'SIDE', parents: ['Meny'], message: 'Velg en side eller et område', level: 'error'})
  // A sub-item's: under both lists; a rule naming no field: on the item itself.
  const under = cases.find((x) => x.name === 'meny.under: sub-items one by one')!
  assert.deepEqual(crossProblems(docOf(under), schemaOf(under.rule)).map((x) => [x.path, x.parents]), [['meny[_key=="a"].under[_key=="u2"].side', ['Meny', 'Under']], ['meny[_key=="b"].under[_key=="u3"].side', ['Meny', 'Under']]])
  const knagg = cases.find((x) => x.name === 'sakerFraKnagg: only that type, no fields names the item')!
  assert.deepEqual(crossProblems(docOf(knagg), schemaOf(knagg.rule)).map((x) => [x.path, x.title]), [['innhold[_key=="k2"]', 'Innhold']])
})

test("after a save, Barkpark's item finding is the problem the studio already shows", () => {
  const c = cases.find((x) => x.name === 'meny: second item has neither')!
  const own = crossProblems(docOf(c), schemaOf(c.rule))
  const finding: Finding = {path: '/meny/1/side', message: 'Velg en side eller et område', code: 'cross_validation'}
  assert.deepEqual(advisoryProblems(keyedAt([finding], c.doc), schemaOf(c.rule), own, (s) => s), [])
  // Keyed by the document it was found in (the save's), not the form's list reordered since.
  const saved = {meny: [{_key: 'a'}, {_key: 'b'}]}
  assert.equal(keyedAt([finding], saved)[0]!.at, 'meny[_key=="b"].side')
  const [moved] = advisoryProblems(keyedAt([finding], saved), schemaOf(c.rule), [], (s) => s)
  assert.equal(moved!.path, 'meny[_key=="b"].side')
  // Other findings keep their own path.
  assert.equal(keyedAt([{path: '/meny/1/tittel', message: 'Required', code: 'required'}], saved)[0]!.at, undefined)
  assert.equal(formPathIn('/meny/0/under/1/side', {meny: [{_key: 'a', under: [{}, {}]}]}), 'meny[_key=="a"].under[1].side')
  assert.equal(formPathIn('/seo/metaTitle', {}), 'seo.metaTitle')
})

test('past 50 broken items, one problem on the list says how many more', () => {
  const c = cases.find((x) => x.name === 'cap: 52 broken items name 50, then one at the list')!
  const got = crossProblems(docOf(c), schemaOf(c.rule))
  assert.equal(got.length, ITEM_CAP + 1)
  assert.deepEqual(got.at(-1), {path: 'meny', title: 'Meny', message: 'Velg en side eller et område (2 more items)', level: 'error'})
  // A nested list's summary is on the outer field too: Barkpark's "/meny/under" is a label, not a pointer.
  const nested = cases.find((x) => x.name === 'cap: nested list summary')!
  assert.deepEqual(crossProblems(docOf(nested), schemaOf(nested.rule)).at(-1)!.path, 'meny')
  const label: Finding = {path: '/meny/under', message: 'x (10 more items)', code: 'cross_validation'}
  assert.equal(keyedAt([label], nested.doc)[0]!.at, 'meny')
  assert.equal(keyedAt([{path: '/side', message: 'x', code: 'cross_validation'}], nested.doc)[0]!.at, undefined)
})
