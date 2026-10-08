// J38: the search filter model, checked against what Sanity 6.17 shows.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Schema} from './data.ts'
import {allFields, BUILTINS, filterLabel, filterMenu, labelText, toRefFilter, type SearchFilter} from './search-filters.ts'

const post: Schema = {
  name: 'post',
  title: 'Post',
  fields: [
    {name: 'title', title: 'Title', type: 'string'},
    {name: 'slug', title: 'Slug', type: 'slug'},
    {name: 'rating', title: 'Rating', type: 'number'},
    {name: 'publishedAt', title: 'Published at', type: 'datetime'},
    {name: 'stage', title: 'Stage', type: 'select', options: ['idea', 'done']},
    {name: 'seo', title: 'Seo', type: 'composite', fields: [{name: 'metaTitle', title: 'Meta Title', type: 'string'}]},
  ],
}
const author: Schema = {name: 'author', title: 'Author', fields: [{name: 'name', title: 'Name', type: 'string'}, {name: 'slug', title: 'Slug', type: 'slug'}]}
const fields = new Map([...BUILTINS, ...allFields([post, author])].map((f) => [f.key, f]))
const f = (field: string, op: SearchFilter['op'], value?: string, to?: string): SearchFilter => ({id: 'x', field, op, value, to})

test('Add filter: dates, then All fields; with types picked, Shared fields and one list per type', () => {
  const titles = (types: string[], find = '') => filterMenu([post, author], types, find).map((s) => [s.title, s.fields.map((x) => x.title)])
  assert.deepEqual(titles([])[1], ['All fields', ['Meta Title', 'Name', 'Published at', 'Rating', 'Slug', 'Stage', 'Title']])
  assert.deepEqual(titles(['author', 'post']).map(([t]) => t), [undefined, 'Shared fields', 'Author', 'Post'])
  assert.deepEqual(titles(['author', 'post'])[1], ['Shared fields', ['Slug']])
  assert.deepEqual(titles([], 'title'), [['All fields', ['Meta Title', 'Title']]])
})

test('filters become Barkpark query filters; a type without the field drops out', () => {
  const now = new Date('2026-10-08T12:00:00Z')
  assert.deepEqual(toRefFilter(post, [f('seo.metaTitle:string', 'contains', 'post 1'), f('rating:number', 'range', '2', '4')], fields, now), {
    'seo.metaTitle': {contains: 'post 1'},
    rating: {gte: '2', lte: '4'},
  })
  assert.deepEqual(toRefFilter(post, [{...f('_updatedAt', 'last', '7'), unit: 'days'}, f('stage:select', 'defined')], fields, now), {
    _updatedAt: {gte: '2026-10-01T12:00:00Z'},
    stage: {is: 'notnull'},
  })
  assert.equal(toRefFilter(author, [f('rating:number', 'eq', '3')], fields, now), null)
  // Not set yet: asks nothing.
  assert.deepEqual(toRefFilter(post, [f('title:string', 'contains')], fields, now), {})
})

test('chip wording is Sanity\'s', () => {
  const label = (x: SearchFilter) => labelText(filterLabel(x, fields.get(x.field)))
  assert.equal(label(f('rating:number', 'gte', '3')), 'Rating ≥ 3')
  assert.equal(label({...f('_updatedAt', 'last', '7'), unit: 'days'}), 'Edited at is in the last 7 days')
  assert.equal(label(f('stage:select', 'notDefined')), 'Stage is empty')
  assert.equal(label(f('title:string', 'contains')), 'Title')
})
