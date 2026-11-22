// task-e65341609dbe504b: a strong reference that is an array's item must point at a published
// document, as a reference field must (Sanity's). Same words, same reads (refsToRead, validate's
// own walk), the error on the item's path. A weak member's items are never read nor judged.
// Every other array case answers exactly as before: each case below names what main answers
// and what is added.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validate} from './validation.ts'
import {refsToRead} from './publish-check.ts'

const to = [{type: 'medlem'}]
const ref = {type: 'reference', to}
const schema = {
  name: 'sak',
  title: 'Sak',
  fields: [
    {name: 'refs', title: 'Medlemmer', type: 'arrayOf', of: ref},
    {name: 'svake', title: 'Svake', type: 'arrayOf', of: {...ref, weak: true}},
    {name: 'flere', title: 'Flere', type: 'arrayOf', of: [ref, {type: 'reference', to: [{type: 'sak'}]}]},
    {name: 'unike', title: 'Unike', type: 'arrayOf', of: ref, validation: {unique: true}},
    {name: 'maks', title: 'Maks', type: 'arrayOf', of: ref, validation: {max: 1}},
    {name: 'paakrevd', title: 'Påkrevd', type: 'arrayOf', of: ref, validation: {required: true}},
    {name: 'kort', title: 'Kort', type: 'arrayOf', of: {type: 'composite', title: 'Kort', fields: [{name: 'medlem', title: 'Medlem', type: 'reference', to}]}},
    {name: 'inni', title: 'Inni', type: 'composite', fields: [{name: 'refs', title: 'Medlemmer', type: 'arrayOf', of: ref}]},
    {name: 'tekster', title: 'Tekster', type: 'arrayOf', of: {type: 'string'}},
    // Rich text (#1378): its blocks keep only an image's minWidth warning; references there are not judged.
    {name: 'tekst', title: 'Tekst', type: 'richText', blocks: {of: [{name: 'personblokk', title: 'Personer', fields: [{name: 'personer', title: 'Personer', type: 'arrayOf', of: ref}, {name: 'person', title: 'Person', type: 'reference', to}]}]}},
  ],
} as never

/** The targets as the pane's reads have them: published, a draft only, gone; any other id still loading. */
const targets: Record<string, {_id: string; _hasPublished: boolean} | null> = {pub: {_id: 'pub', _hasPublished: true}, ny: {_id: 'ny', _hasPublished: false}, borte: null}
const target = (id: string) => (id in targets ? targets[id] : undefined) as never
const r = (key: string, id: string) => ({_key: key, _type: 'reference', _ref: id})
const err = (path: string, title: string, message: string, parents?: string[]) => ({path, title, message, level: 'error', ...(parents ? {parents} : {})})
const MUST = 'Referenced document must be published'

/** [case, the draft's fields, main's answer, what this task adds]. */
const cases: [string, Record<string, unknown>, object[], object[]][] = [
  ['published items', {refs: [r('a', 'pub')]}, [], []],
  ['an item whose target is a draft only', {refs: [r('a', 'pub'), r('b', 'ny')]}, [], [err('refs[_key=="b"]', 'Medlemmer', MUST)]],
  ['an item whose target is gone', {refs: [r('a', 'borte')]}, [], [err('refs[_key=="a"]', 'Medlemmer', MUST)]],
  ['an item whose target is still loading', {refs: [r('a', 'lastes')]}, [], []],
  ['a bare id item', {refs: ['ny']}, [], [err('refs[0]', 'Medlemmer', MUST)]],
  ['an empty row', {refs: [{_key: 'a'}]}, [err('refs[_key=="a"]', 'Medlemmer', 'Must be a reference to a document')], []],
  ['a weak member', {svake: [r('a', 'ny'), r('b', 'borte')]}, [], []],
  ['several reference members', {flere: [r('a', 'pub'), r('b', 'ny')]}, [], [err('flere[_key=="b"]', 'Flere', MUST)]],
  ['a duplicate under unique', {unike: [r('a', 'pub'), r('b', 'pub')]}, [err('unike', 'Unike', "Can't be a duplicate")], []],
  ['too many items', {maks: [r('a', 'pub'), r('b', 'pub')]}, [err('maks', 'Maks', 'Must have at most 1 items')], []],
  ['a required array left empty', {paakrevd: []}, [err('paakrevd', 'Påkrevd', 'Required')], []],
  ['object items holding a reference (#1381)', {kort: [{_key: 'a', medlem: {_ref: 'ny'}}]}, [err('kort[_key=="a"].medlem', 'Medlem', MUST, ['Kort'])], []],
  ['an array of references inside an object', {inni: {refs: [r('a', 'ny')]}}, [], [err('inni.refs[_key=="a"]', 'Medlemmer', MUST, ['Inni'])]],
  ['an array of strings', {tekster: ['x']}, [], []],
  ['references in a rich-text block', {tekst: [{_key: 'p', _type: 'personblokk', personer: [r('a', 'ny')], person: {_ref: 'borte'}}]}, [], []],
]
// The required array holds one published item unless a case leaves it empty.
const draft = (fields: Record<string, unknown>) => ({_id: 'drafts.s', _publishedId: 's', _type: 'sak', _draft: true, paakrevd: [r('z', 'pub')], ...fields}) as never
const answer = (fields: Record<string, unknown>, t = target) => JSON.parse(JSON.stringify(validate(draft(fields), schema, t)))

test('a strong reference item must point at a published document: added on the item; every other array case answers as on main', () => {
  for (const [name, fields, main, added] of cases) assert.deepEqual(answer(fields), [...main, ...added], name)
  // No reads asked (no target): nothing is judged, as on main.
  assert.deepEqual(validate(draft({refs: [r('b', 'ny')]}), schema), [], 'no target')
})

test('what is read is what is judged: each strong item\'s target once per draft, a weak member\'s never', () => {
  const reads = refsToRead(schema, draft({refs: [r('a', 'ny'), r('b', 'ny'), r('c', 'pub')], svake: [r('d', 'borte')], flere: [r('e', 'pub')], inni: {refs: [r('f', 'x')]}}))
  assert.deepEqual(reads.map((x) => x.id), ['ny', 'pub', 'x'])
  // A rich-text block's references are not judged (#1378 keeps only image warnings there), so not read.
  assert.deepEqual(refsToRead(schema, draft({tekst: [{_key: 'p', _type: 'personblokk', personer: [r('a', 'ny')], person: {_ref: 'borte'}}]})).map((x) => x.id), ['pub'], 'only the required array\'s own item')
  // Each read asks the member's own target types (several members: all of them).
  const flere = refsToRead(schema, draft({flere: [r('e', 'pub')]}))
  assert.deepEqual(flere.map((x) => x.field.to), [[{type: 'medlem'}, {type: 'sak'}]])
})
