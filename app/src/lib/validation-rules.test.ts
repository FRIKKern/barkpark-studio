import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validate} from './validation.ts'
import fields from '../i18n/nb/fields.ts'
import type {Doc, Field, Rule} from './data.ts'

// Sanity's other rule builders (sanity 6.17.0, @sanity/validation's string, number, date,
// array and object validators), written as data on the field, checked through validate():
// the same path the form, the validation panel and Publish read.
const en = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : s)
const nb = (s: string, vars?: Record<string, string | number>) => en((fields as Record<string, string>)[s] ?? s, vars)
const doc = (value: unknown) => ({_id: 'p', _publishedId: 'p', _type: 't', _draft: true, _rev: 'r', _updatedAt: '', x: value}) as Doc
/** The problems of one field `x` holding `value`, as "level: message". */
const said = (type: string, validation: Rule | Rule[], value: unknown, extra: Partial<Field> = {}, t = en) =>
  validate(doc(value), {name: 't', title: 'T', fields: [{name: 'x', type, validation, ...extra} as Field]}, undefined, t).map((p) => `${p.level}: ${p.message}`)

test("Sanity's exact messages for exact length, precision, an inverted pattern and a date minimum", () => {
  assert.deepEqual(said('string', {length: 5}, 'abc'), ['error: Must be exactly 5 characters long'])
  assert.deepEqual(said('number', {precision: 2, level: 'warning'}, 1.234), ['warning: Max precision is 2'])
  assert.deepEqual(said('string', {pattern: '^a', invert: true, name: 'starts with a'}, 'abc'), ['error: Should not match "starts with a"-pattern'])
  assert.deepEqual(said('date', {min: '2026-01-01', level: 'info'}, '2025-12-31'), ['info: Must be at or after 2026-01-01'])
  // What passes says nothing; an empty field is left to `required`, as Sanity's.
  assert.deepEqual([...said('string', {length: 5}, 'abcde'), ...said('number', {precision: 2}, 1.23), ...said('string', {pattern: '^a', invert: true}, 'bca'), ...said('date', {min: '2026-01-01'}, '2026-01-01'), ...said('string', {length: 5}, '')], [])
})

test('greater and less than, positive, negative, casing, a named pattern, date max, exact item count, an asset', () => {
  assert.deepEqual(said('number', [{greaterThan: 1}, {lessThan: 0}], 1), ['error: Must be greater than 1', 'error: Must be less than 0'])
  // Sanity: positive() is min(0), negative() is lessThan(0).
  assert.deepEqual(said('number', [{positive: true}, {negative: true}], -1), ['error: Must be greater than or equal to 0'])
  assert.deepEqual(said('number', {negative: true}, 0), ['error: Must be less than 0'])
  assert.deepEqual(said('number', {precision: 0, greaterThan: 0}, 1e-7), ['error: Max precision is 0'])
  assert.deepEqual(said('string', [{lowercase: true}, {uppercase: true}], 'Ab'), ['error: Must be all lowercase characters', 'error: Must be all uppercase characters'])
  assert.deepEqual(said('string', {pattern: '^\\d+$', name: 'digits'}, '12a'), ['error: Does not match "digits"-pattern'])
  // The field's own dateFormat shapes the date in the message (UTC for a date), as Sanity's.
  assert.deepEqual(said('date', {max: '2026-12-31'}, '2027-01-01', {options: {dateFormat: 'DD.MM.YYYY'}}), ['error: Must be at or before 31.12.2026'])
  const at = new Date('2026-03-01T12:30:00Z')
  const local = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  assert.deepEqual(said('datetime', {min: '2026-03-01T12:30:00Z'}, '2026-03-01T12:29:00Z'), [`error: Must be at or after ${local}`])
  // A date's min and max never read as a length: a string min on a date is a date, a number min on text is still a length.
  assert.deepEqual(said('string', {min: 3}, 'ab'), ['error: Must be at least 3 characters long'])
  assert.deepEqual(said('arrayOf', {length: 2}, ['a'], {of: {name: 'i', type: 'string'}}), ['error: Must have exactly 2 items'])
  assert.deepEqual(said('richText', {length: 2}, [{_type: 'block', _key: 'a'}]), ['error: Must have exactly 2 blocks'])
  assert.deepEqual(said('image', {assetRequired: true}, {_type: 'image', alt: 'A dog'}), ['error: Image is required'])
  assert.deepEqual(said('file', {assetRequired: true}, {_type: 'file'}), ['error: File is required'])
  assert.deepEqual(said('image', {assetRequired: true}, {_type: 'image', asset: {_type: 'reference', _ref: 'image-a'}}), [])
  // The rule's own message wins, as everywhere.
  assert.deepEqual(said('number', {greaterThan: 0, message: 'Above zero, please'}, 0), ['error: Above zero, please'])
})

test("nb-NO: Sanity's Norwegian for each rule", () => {
  assert.deepEqual(said('string', [{length: 5}, {lowercase: true}, {pattern: '^a', invert: true, name: 'a først'}], 'Abc', {}, nb), ['error: Må være nøyaktig 5 tegn lang', 'error: Må bestå av kun små bokstaver'])
  assert.deepEqual(said('string', {pattern: '^a', invert: true, name: 'a først'}, 'abc', {}, nb), ['error: Må ikke stemme overens med "a først"-mønsteret'])
  assert.deepEqual(said('number', [{precision: 1}, {greaterThan: 5}], 1.25, {}, nb), ['error: Maksimal presisjon er 1', 'error: Må være større enn 5'])
  assert.deepEqual(said('date', [{min: '2026-01-01'}], '2025-01-01', {}, nb), ['error: Må være på eller etter 2026-01-01'])
  assert.deepEqual(said('image', {assetRequired: true}, {alt: 'x'}, {}, nb), ['error: Bilde er påkrevd'])
})
