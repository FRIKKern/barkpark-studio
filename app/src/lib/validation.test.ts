import {test} from 'node:test'
import assert from 'node:assert/strict'
import {formOrder, validate} from './validation.ts'
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
    {name: 'tags', type: 'arrayOf', of: {name: 'tag', type: 'reference', refType: 'tag'}, validation: {unique: true}},
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

test('unique: an arrayOf with the same reference or value twice', () => {
  assert.deepEqual(messages({slug: 'a', tags: [{_key: 'a', _ref: 't1'}, {_key: 'b', _ref: 't1'}]}), ["tags error: Can't be a duplicate"])
  assert.deepEqual(messages({slug: 'a', tags: [{_key: 'a', _ref: 't1'}, {_key: 'b', _ref: 't2'}]}), [])
})


// Sanity's types validate their own shape (url, email, integer, date), as errors.
test('type rules: a url, an email, a whole number, a date of the wrong shape', () => {
  const typed: Schema = {
    name: 'contact',
    title: 'Contact',
    fields: [
      {name: 'site', type: 'url'},
      {name: 'mail', type: 'email'},
      {name: 'count', type: 'integer'},
      {name: 'day', type: 'date'},
    ],
  }
  const of = (fields: Record<string, unknown>) => validate(doc(fields), typed).map((p) => `${p.path} ${p.level}: ${p.message}`)
  assert.deepEqual(of({site: 'not a url', mail: 'nobody', count: 2.5, day: 'soon'}), [
    'site error: Not a valid URL',
    'mail error: Must be a valid email address',
    'count error: Must be an integer',
    'day error: Must be a valid ISO-8601 formatted date string',
  ])
  assert.deepEqual(of({site: 'https://example.com/a', mail: 'a@b.no', count: 3, day: '2026-10-11'}), [])
})

// An array's item count as you type (Sanity's Rule.min/max on an array), with its level.
test('array count: min and max items, as you type', () => {
  const listed: Schema = {
    name: 'post',
    title: 'Post',
    fields: [
      {name: 'tags', type: 'arrayOf', of: {name: 'tag', type: 'string'}, validation: {max: 3, level: 'warning'}},
      {name: 'authors', type: 'arrayOf', of: {name: 'a', type: 'string'}, validation: {min: 2}},
    ],
  }
  const of = (fields: Record<string, unknown>) => validate(doc(fields), listed).map((p) => `${p.path} ${p.level}: ${p.message}`)
  assert.deepEqual(of({tags: ['a', 'b', 'c', 'd'], authors: ['x']}), ['tags warning: Must have at most 3 items', 'authors error: Must have at least 2 items'])
  assert.deepEqual(of({tags: ['a', 'b', 'c'], authors: ['x', 'y']}), [])
})

// Sanity's url type takes http and https only, and no credentials in the URL (probed on Sanity 6.17).
test('url: http(s) only, no username or password, absolute', () => {
  const linked: Schema = {name: 'post', title: 'Post', fields: [{name: 'site', type: 'url'}]}
  const of = (site: string) => validate(doc({site}), linked).map((p) => p.message)
  assert.deepEqual(of('mailto:a@b.no'), ['Does not match allowed protocols/schemes'])
  assert.deepEqual(of('ftp://x.com/a'), ['Does not match allowed protocols/schemes'])
  assert.deepEqual(of('https://user:pw@x.com'), ['Username/password not allowed'])
  assert.deepEqual(of('/relative'), ['Not a valid URL'])
  assert.deepEqual(of('http://x.com'), [])
})

test("an array item's fields are checked, named as Sanity's (Links / External link / URL)", () => {
  const links: Schema = {
    name: 'post',
    title: 'Post',
    fields: [
      {
        name: 'links',
        title: 'Links',
        type: 'arrayOf',
        of: {
          name: 'link',
          type: 'composite',
          options: {typeField: 'kind', fieldsByType: {externalLink: ['title', 'url'], docLink: ['title']}},
          fields: [
            {name: 'kind', type: 'select', options: [{value: 'externalLink', title: 'External link'}]},
            {name: 'title', type: 'string', validation: {max: 5}},
            {name: 'url', title: 'URL', type: 'url'},
          ],
        },
      },
      {name: 'sites', type: 'arrayOf', of: {name: 'site', type: 'url'}},
    ],
  }
  const got = validate(doc({links: [{_key: 'l1', kind: 'externalLink', title: 'ok', url: 'not a url'}, {_key: 'l2', kind: 'docLink', url: 'not a url either'}], sites: ['https://ok.example', '/relative']}), links)
  assert.deepEqual(
    got.map((p) => `${p.path} ${[...(p.parents ?? []), p.title].join(' / ')}: ${p.message}`),
    ['links[_key=="l1"].url Links / External link / URL: Not a valid URL', 'sites[1] sites: Not a valid URL'],
  )
})

// task-79f70acdb29bc226: the panel lists problems in the form's order, nested fields too:
// Sanity's "SEO / Meta title" before "SEO / Meta description"; a document rule first.
test('problems sort in the form order, nested fields by their own order', () => {
  const schema = {name: 'post', title: 'Post', fields: [
    {name: 'excerpt', type: 'text'},
    {name: 'tags', type: 'array'},
    {name: 'seo', type: 'object', fields: [{name: 'metaTitle', type: 'string'}, {name: 'metaDescription', type: 'text'}]},
  ]} as unknown as Schema
  const paths = ['seo.metaDescription', 'tags', 'seo.metaTitle', '', 'excerpt']
  assert.deepEqual([...paths].sort((a, b) => formOrder(schema, a, b)), ['', 'excerpt', 'tags', 'seo.metaTitle', 'seo.metaDescription'])
})
