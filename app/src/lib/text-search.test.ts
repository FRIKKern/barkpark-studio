// J38: global search hits, checked against what Sanity 6.17 returns for the same
// fixture docs (reference project, groq2024 search, 2026-10-08).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Schema} from './data.ts'
import {excluded, parseTextQuery, textScore} from './text-search.ts'

const post: Schema = {
  name: 'post',
  title: 'Post',
  fields: [
    {name: 'title', type: 'string'},
    {name: 'slug', type: 'slug'},
    {name: 'excerpt', type: 'text'},
    {name: 'author', type: 'reference', refType: 'author'},
    {name: 'body', type: 'richText'},
    {name: 'links', type: 'arrayOf', of: {name: 'link', type: 'composite', fields: [{name: 'title', type: 'string'}, {name: 'target', type: 'reference'}]}},
  ],
}
const p30 = {
  _id: 'post-30',
  _publishedId: 'post-30',
  _type: 'post',
  title: 'Fixture post 30',
  slug: 'fixture-post-30',
  excerpt: 'Short excerpt for post 30.',
  author: 'author-ada',
  featuredNote: 'Featured in the post 30 newsletter.',
  body: {blocks: [{id: 'h30', type: 'heading', level: 2, content: [{type: 'text', value: 'Heading'}]}, {id: 'p30', type: 'paragraph', content: [{type: 'text', value: 'Status, written with '}, {type: 'wikilink', target: 'author-grace', docId: 'author-grace', children: [{type: 'text', value: 'Ada'}]}]}]},
  links: [{_key: 'l1', title: 'Docs', target: 'post-01'}],
}
const s = (q: string, doc: Record<string, unknown> = p30) => textScore(doc, parseTextQuery(q), post)

test('every text field matches, the last word as a prefix (results follow typing)', () => {
  assert.equal(s('excer'), 1) // excerpt
  assert.equal(s('newsletter'), 1) // a plain string field
  assert.equal(s('heading'), 1) // rich text
  assert.equal(s('Ada.'), 1) // rich text inside a link, punctuation ignored
  assert.equal(s('docs'), 1) // a field of an array item
  assert.equal(s('excer post'), 11) // only the last word is a prefix: "excer" alone is no word
})

test('references, keys and block structure are not text', () => {
  assert.equal(s('grace'), 0) // wikilink target
  assert.equal(s('paragraph'), 0) // block type
  assert.equal(s('h30'), 0) // block id
  assert.equal(s('post-0'), 0) // a link target's id is not text
  assert.equal(s('post-01'), 1) // ...but a doc referencing the exact id typed is a hit (Sanity's references())
  assert.equal(s('author-grace'), 1) // a wikilink is a reference too
})

test('title hits rank first; words are OR-ed; -word excludes; "a b" and a-b are phrases', () => {
  assert.equal(s('fixture'), 11)
  assert.equal(s('post 30'), 22)
  assert.equal(s('excerpt 30'), 12)
  assert.equal(s('ada -fixture'), 0)
  assert.equal(s('"post 30"'), 11)
  assert.equal(s('"30 post"'), 0)
  assert.equal(s('post-3'), 11) // phrase "post 3*", like Sanity's post-3 → post-30
  assert.equal(s('fixture-p'), 11)
})

test('æ folds to "ae" in titles, as on Sanity; not in body text, and ø and å never', () => {
  const doc = {_id: 'x', title: 'Ærlig talt om økonomi', excerpt: 'Ærlighet varer. Årsrapport'}
  assert.ok(textScore(doc, parseTextQuery('aerlig')) > 0)
  assert.ok(textScore(doc, parseTextQuery('Ærlig')) > 0)
  assert.equal(textScore({_id: 'y', title: 'Ordtak', excerpt: 'Ærlighet varer.'}, parseTextQuery('aerlighet')), 0)
  assert.ok(textScore({_id: 'y', title: 'Ordtak', excerpt: 'Ærlighet varer.'}, parseTextQuery('ærlighet')) > 0)
  assert.equal(textScore(doc, parseTextQuery('okonomi')), 0)
  assert.equal(textScore(doc, parseTextQuery('arsrapport')), 0)
  // An exclusion folds in the title too.
  assert.ok(excluded(doc, parseTextQuery('talt -aerlig')))
})
