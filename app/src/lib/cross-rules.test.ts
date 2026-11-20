// task-2e7436fc92a6a703: a schema's cross_validations (Barkpark checks them at every write)
// show in the studio as you type, under each field the rule names, at the rule's level.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import type {Doc, Schema} from './data.ts'
import {validate} from './validation.ts'

// The repo's own fixture type, as Barkpark serves it: the rules as `crossValidations`.
const post = JSON.parse(readFileSync(new URL('../../../fixtures/barkpark-schema/post.json', import.meta.url), 'utf8')) as Schema
const withRules = (crossValidations: unknown[]) => ({...post, crossValidations}) as Schema
const doc = (fields: Record<string, unknown>) => ({_id: 'p1', _type: 'post', title: 'Hello', ...fields}) as unknown as Doc

const excerptWhenFeatured = {
  name: 'excerpt_when_featured',
  title: 'A featured post needs an excerpt',
  rule: {any: [{field: 'featured', operator: 'neq', value: true}, {field: 'excerpt', operator: 'non_empty'}]},
  level: 'warning',
  fields: ['excerpt'],
}
const cross = (d: Doc, s: Schema) => validate(d, s).filter((p) => p.message === excerptWhenFeatured.title || p.message.startsWith('Rule '))

test("a cross rule's violation shows under the field it names", () => {
  const s = withRules([excerptWhenFeatured])
  assert.deepEqual(cross(doc({featured: true}), s), [{path: 'excerpt', title: 'Excerpt', group: 'content', message: 'A featured post needs an excerpt', level: 'warning'}])
  assert.deepEqual(cross(doc({featured: true, excerpt: 'Short'}), s), [])
  assert.deepEqual(cross(doc({featured: false}), s), [])
})

test('a cross rule naming two fields shows under both; naming none, on the document; error is the default level', () => {
  const rule = {name: 'Rule two', rule: {all: [{field: 'rating', operator: 'non_empty'}, {any: [{field: 'stage', operator: 'eq', value: 'done'}]}]}}
  const s = withRules([{...rule, fields: ['rating', 'stage']}, {...rule, name: 'Rule none'}])
  assert.deepEqual(cross(doc({rating: 3, stage: 'draft'}), s), [
    {path: 'rating', title: 'Rating', group: 'meta', message: 'Rule two', level: 'error'},
    {path: 'stage', title: 'Stage', group: 'meta', message: 'Rule two', level: 'error'},
    {path: '_document', title: '', message: 'Rule none', level: 'error'},
  ])
  assert.deepEqual(cross(doc({rating: 3, stage: 'done'}), s), [])
})

test('a schema without cross rules validates as before, and a rule the server cannot evaluate is skipped quietly', () => {
  const d = doc({featured: true, rating: 3})
  const before = validate(d, post)
  assert.deepEqual(validate(d, withRules([])), before)
  const odd = [
    {name: 'Rule unknown operator', rule: {field: 'excerpt', operator: 'gte_field', value: 'title'}, fields: ['excerpt']},
    {name: 'Rule undeclared field', rule: {field: 'nope', operator: 'non_empty'}, fields: ['excerpt']},
    {name: 'Rule empty any', rule: {any: []}},
    {name: 'Rule no body'},
    'not a rule',
    null,
  ]
  assert.deepEqual(validate(d, withRules(odd)), before)
})
