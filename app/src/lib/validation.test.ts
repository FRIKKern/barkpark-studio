import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validate} from './validation.ts'
import type {Doc, Schema} from './data.ts'

// Sanity's Rule.regex as Barkpark declares it (`validation: {pattern, message}`), single
// or in a list, on text and on a slug's current; a bad regex is skipped.
const SLUG = '^[a-z0-9]+(?:-[a-z0-9]+)*$'
const schema: Schema = {
  name: 'post',
  title: 'Post',
  fields: [
    {name: 'slug', type: 'slug', validation: [{required: true}, {pattern: SLUG, message: 'Lowercase words joined by dashes'}]},
    {name: 'code', type: 'string', validation: {pattern: '^[A-Z]{3}$'}},
    {name: 'note', type: 'string', validation: {pattern: '^ok', level: 'warning'}},
    {name: 'broken', type: 'string', validation: {pattern: '('}},
  ],
}
const doc = (fields: Record<string, unknown>) => ({_id: 'p', _publishedId: 'p', _type: 'post', _draft: true, _rev: 'r', _updatedAt: '', ...fields}) as Doc
const messages = (fields: Record<string, unknown>) => validate(doc(fields), schema).map((p) => `${p.path} ${p.level}: ${p.message}`)

test('pattern: its message, or Sanity\'s; on a slug\'s current; a warning level', () => {
  assert.deepEqual(messages({slug: {current: 'Bad Slug'}, code: 'abc', note: 'nope', broken: 'x'}), [
    'slug error: Lowercase words joined by dashes',
    'code error: Does not match "/^[A-Z]{3}$/"-pattern',
    'note warning: Does not match "/^ok/"-pattern',
  ])
  assert.deepEqual(messages({slug: 'good-slug-2', code: 'ABC', note: 'ok then'}), [])
  assert.deepEqual(messages({}), ['slug error: Required'])
})
