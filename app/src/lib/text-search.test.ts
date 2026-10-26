// J38: global search hits, checked against what Sanity 6.17 returns for the same
// fixture docs (reference project, groq2024 search, 2026-10-08).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Schema} from './data.ts'
import {excluded, memberPreviewRefs, parseTextQuery, refBoost, textScore, tieLength} from './text-search.ts'

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

test('titles fold æøå (never fewer hits than Sanity), the exact spelling first; body text as written', () => {
  const doc = {_id: 'x', title: 'Ærlig talt om økonomi', excerpt: 'Ærlighet varer.'}
  const report = {_id: 'r', title: 'Årsrapport 2026', excerpt: 'x'}
  for (const q of ['aerlig', 'Ærlig', 'okonomi', 'oekonomi', 'økonomi']) assert.ok(textScore(doc, parseTextQuery(q)) > 0, q)
  for (const q of ['arsrapport', 'aarsrapport', 'årsrap']) assert.ok(textScore(report, parseTextQuery(q)) > 0, q)
  // As typed ranks over folded.
  assert.ok(textScore({_id: 'e', title: 'Okonomi og kurs'}, parseTextQuery('okonomi')) > textScore(doc, parseTextQuery('okonomi')))
  // Body text does not fold (as Sanity): "aerlighet" finds no body "Ærlighet".
  assert.equal(textScore({_id: 'y', title: 'Ordtak', excerpt: 'Ærlighet varer.'}, parseTextQuery('aerlighet')), 0)
  assert.ok(textScore({_id: 'y', title: 'Ordtak', excerpt: 'Ærlighet varer.'}, parseTextQuery('ærlighet')) > 0)
  // An exclusion folds in the title too.
  assert.ok(excluded(doc, parseTextQuery('talt -aerlig')))
  assert.ok(excluded(doc, parseTextQuery('talt -okonomi')))
})

test("ids match as Sanity tokenizes them: a dot stays in the word, a draft-only doc has only its drafts. id", () => {
  const draftOnly = {_id: 'drafts.sq-fox', _publishedId: 'sq-fox', _type: 'post', _draft: true, _hasPublished: false, title: 'The quick brown fox'}
  const draftOfPublished = {...draftOnly, _id: 'drafts.post-09', _publishedId: 'post-09', _hasPublished: true, title: 'Nine'}
  // Sanity 6.17 on the reference, 2026-10-10: "sq-fox" finds nothing, "drafts.sq-fox" and "fox-rev" find the drafts.
  assert.equal(s('sq-fox', {...draftOnly, title: 'Other'}), 0)
  assert.equal(s('drafts.sq-fox', {...draftOnly, title: 'Other'}), 1)
  assert.equal(s('fox-rev', {...draftOnly, _id: 'drafts.sq-fox-rev', _publishedId: 'sq-fox-rev', title: 'Other'}), 1)
  // A published doc's id, and a draft's of a published doc, match by their words ("post-01" finds post 01).
  assert.equal(s('post-30'), 11)
  assert.equal(s('post-09', draftOfPublished), 1)
  assert.equal(s('drafts.post-09', draftOfPublished), 1)
})

test("equal hits rank as Sanity's best match: a matching link target first, then the shorter doc", () => {
  // Sanity (e2e-local, 'Fixture post', 2026-10-26): post-09 (links to post-10) above post-01,
  // and post-01 (34 words) above post-04 (39). Its score is BM25: shorter docs score higher
  // for a whole word ("Fixture"); a prefix alone scores flatly (scratch docs, same day).
  const linked = {...post, fields: post.fields.map((f) => (f.name === 'links' ? {...f, of: {...f.of!, preview: {title: 'title', subtitle: 'target'}}} : f))}
  assert.deepEqual(memberPreviewRefs(linked.fields).map((r) => r.name), ['target'])
  assert.deepEqual(memberPreviewRefs(post.fields), []) // an item preview that reads no reference
  const doc = (id: string, excerpt: string, target?: string) => ({_id: id, _type: 'post', title: `Fixture post ${id.slice(-2)}`, excerpt, ...(target && {links: [{_key: 'l', title: 'Related', target}]})})
  const docs = [doc('post-04', 'A longer excerpt with a few more words in it.'), doc('post-01', 'Short excerpt.'), doc('post-09', 'A longer excerpt with a few more words.', 'post-10')]
  const q = parseTextQuery('Fixture post')
  const matched = new Set(['post-01', 'post-04', 'post-09', 'post-10'])
  assert.equal(refBoost(docs[2]!, matched, linked), 5)
  assert.equal(refBoost(docs[2]!, new Set(['post-11']), linked), 0)
  assert.equal(refBoost(docs[1]!, matched, linked), 0)
  assert.ok(tieLength(docs[1]!, q, linked) < tieLength(docs[0]!, q, linked))
  assert.equal(tieLength(docs[0]!, parseTextQuery('fixture'), linked), 0) // one word: a prefix, no tie-break
  const ranked = docs
    .map((d) => ({d, score: textScore(d, q, linked) + refBoost(d, matched, linked)}))
    .sort((a, b) => b.score - a.score || tieLength(a.d, q, linked) - tieLength(b.d, q, linked))
  assert.deepEqual(ranked.map((r) => r.d._id), ['post-09', 'post-01', 'post-04'])
})
