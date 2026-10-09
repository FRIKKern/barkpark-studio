// J38: the search filter model, checked against what Sanity 6.17 shows.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Schema} from './data.ts'
import {allFields, BUILTINS, filterLabel, filterMenu, labelText, operatorsFor, toRefFilter, type SearchFilter} from './search-filters.ts'

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
    {name: 'categories', title: 'Categories', type: 'arrayOf', of: {name: 'category', type: 'reference', refType: 'category'}},
    {name: 'tags', title: 'Tags', type: 'tags'},
    {name: 'day', title: 'Day', type: 'date'},
  ],
}
const author: Schema = {name: 'author', title: 'Author', fields: [{name: 'name', title: 'Name', type: 'string'}, {name: 'slug', title: 'Slug', type: 'slug'}]}
const fields = new Map([...BUILTINS, ...allFields([post, author])].map((f) => [f.key, f]))
const f = (field: string, op: SearchFilter['op'], value?: string, to?: string): SearchFilter => ({id: 'x', field, op, value, to})

test('Add filter: dates, then All fields; with types picked, Shared fields and one list per type', () => {
  const titles = (types: string[], find = '') => filterMenu([post, author], types, find).map((s) => [s.title, s.fields.map((x) => x.title)])
  assert.deepEqual(titles([])[1], ['All fields', ['Categories', 'Day', 'Meta Title', 'Name', 'Published at', 'Rating', 'Slug', 'Stage', 'Tags', 'Title']])
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

test('the operators barkpark#22106 added: does not contain, includes, counts, a date is not', () => {
  const now = new Date('2026-10-08T12:00:00Z')
  assert.deepEqual(operatorsFor(fields.get('title:string')!)[0], ['contains', 'notContains'])
  assert.deepEqual(operatorsFor(fields.get('categories:arrayRef')!).flat(), ['includes', 'notIncludes', 'defined', 'notDefined', 'countEq', 'countNeq', 'countGt', 'countGte', 'countLt', 'countLte', 'countRange'])
  assert.deepEqual(operatorsFor(fields.get('tags:array')!)[0], ['defined', 'notDefined'])
  assert.deepEqual(operatorsFor(fields.get('day:date')!)[2], ['eq', 'neq'])
  assert.deepEqual(fields.get('categories:arrayRef')!.refTypes, ['category'])
  assert.deepEqual(
    toRefFilter(post, [f('title:string', 'notContains', 'draft'), f('categories:arrayRef', 'notIncludes', 'category-guide'), f('tags:array', 'countRange', '1', '3'), f('day:date', 'neq', '2026-10-01')], fields, now),
    {title: {notContains: 'draft'}, categories: {nhas: 'category-guide'}, tags: {countGte: '1', countLte: '3'}, day: {neq: '2026-10-01'}},
  )
  assert.deepEqual(toRefFilter(post, [f('categories:arrayRef', 'includes', 'category-guide'), f('tags:array', 'countGt', '2')], fields, now), {categories: {has: 'category-guide'}, tags: {countGt: '2'}})
  const label = (x: SearchFilter) => labelText(filterLabel(x, fields.get(x.field)))
  assert.equal(label(f('title:string', 'notContains', 'draft')), 'Title does not contain draft')
  assert.equal(label({...f('categories:arrayRef', 'includes', 'category-guide'), label: 'Guide'}), 'Categories includes Guide')
  assert.equal(label(f('tags:array', 'countEq', '1')), 'Tags has 1 item')
  assert.equal(label(f('tags:array', 'countGte', '2')), 'Tags has ≥ 2 items')
  assert.equal(label(f('tags:array', 'countNeq', '2')), 'Tags does not have 2 items')
  assert.equal(label(f('tags:array', 'countRange', '1', '3')), 'Tags has between 1 → 3 items')
})

test('the pinned "Contains document, image or file" (barkpark _references)', () => {
  const now = new Date('2026-10-08T12:00:00Z')
  const refs = fields.get('_references')!
  assert.deepEqual(operatorsFor(refs), [['refDocument', 'refImage', 'refFile']])
  assert.deepEqual(toRefFilter(author, [{...f('_references', 'refDocument', 'post-01'), label: 'Fixture post 01'}], fields, now), {_references: {'': 'post-01'}})
  assert.equal(labelText(filterLabel({...f('_references', 'refImage', 'asset-x'), label: 'cat.png'}, refs)), 'Contains document, image or file → cat.png')
})
