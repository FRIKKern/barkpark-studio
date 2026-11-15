import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import type {Doc, Schema} from './data'
import {creationChoices, draftsPaths, dropRelated, shadowable, unshadowed, foldRelated, incomingFor, incomingIn, parseIncoming, pointsVia, referenceKind, referencePreset, relatedPath, shownRelated, type Related} from './incoming-refs.ts'
import {FIELD_TYPES} from './schema-vocab.ts'

// Sanity's incoming references input (defineIncomingReferenceDecoration): the pure parts.

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/barkpark-schema/${name}.json`, import.meta.url), 'utf8')) as Schema & {desk?: {views?: (Related & {id: string})[]}}
const post = fixture('post')
const author = fixture('author')
const doc = (id: string, fields: Record<string, unknown> = {}, rev = 'r1'): Doc => ({_id: id, _publishedId: id, _type: 'post', _draft: false, _rev: rev, _updatedAt: '2026-11-01T00:00:00Z', ...fields})
const byAuthor: Related = {type: 'post', by: 'author'}
const byCategory: Related = {type: 'post', by: 'categories'}

test('a declaration is read as written; what cannot be read is left out, never guessed', () => {
  const decls = parseIncoming([
    {name: 'posts', title: 'Posts by this author', description: 'Newest first', group: 'meta', types: [{type: 'post', by: 'author', orderings: [{field: 'title', direction: 'asc'}, {field: 'bad field'}]}]},
    {name: 'reviewedPosts', types: [{type: 'post', by: 'reviewer', title: 'Reviewed'}, {type: 'post'}, 'post'], creationAllowed: ['post-by-alan', 7]},
    {name: 'posts', types: [{type: 'post', by: 'related'}]}, // the name is taken
    {name: 'noTypes', types: []},
    {title: 'No name', types: [{type: 'post', by: 'author'}]},
    {name: 'unsafe', types: [{type: 'post', by: 'author][eq]=x&filter[a'}]},
    {name: 'off', types: [{type: 'post', by: 'author'}], creationAllowed: false},
    'nonsense',
  ])
  assert.deepEqual(decls, [
    {name: 'posts', title: 'Posts by this author', description: 'Newest first', group: 'meta', types: [{type: 'post', by: 'author', orderings: [{field: 'title', direction: 'asc'}]}], creationAllowed: true},
    {name: 'reviewedPosts', title: 'Reviewed Posts', types: [{type: 'post', by: 'reviewer', title: 'Reviewed'}], creationAllowed: ['post-by-alan']},
    {name: 'off', title: 'Off', types: [{type: 'post', by: 'author'}], creationAllowed: false},
  ])
  assert.deepEqual(parseIncoming(undefined), [])
  assert.deepEqual(parseIncoming({name: 'posts'}), [])
})

test("{view} is the relation the type's desk view already declares (the author fixture's Posts tab)", () => {
  const views = author.desk!.views!
  assert.deepEqual(parseIncoming([{name: 'posts', types: [{view: 'posts'}]}], views)[0]!.types, [{type: 'post', by: 'content.author', orderings: [{field: 'title', direction: 'asc'}]}])
  // A view the type does not have names nothing: the list is left out.
  assert.deepEqual(parseIncoming([{name: 'posts', types: [{view: 'nope'}]}], views), [])
})

test("the schema's own lists come first; the config adds those whose name is free; a group shows on its tab and under all fields", () => {
  const own = parseIncoming([{name: 'posts', title: 'From the schema', group: 'meta', types: [{type: 'post', by: 'author'}]}])
  const decls = incomingFor({incoming: own, views: []}, [{name: 'posts', title: 'From the config', types: [{type: 'post', by: 'author'}]}, {name: 'reviews', types: [{type: 'post', by: 'reviewer'}]}])
  assert.deepEqual(decls.map((d) => d.title), ['From the schema', 'Reviews'])
  assert.deepEqual(incomingIn(decls, '').map((d) => d.name), ['posts', 'reviews'])
  assert.deepEqual(incomingIn(decls, 'meta').map((d) => d.name), ['posts'])
  assert.deepEqual(incomingIn(decls, 'content'), [])
  assert.deepEqual(incomingFor(undefined, undefined), [])
})

test('one read serves a reference and an array of references: Barkpark\'s `in`, drafts or published, last edited first by default', () => {
  assert.equal(relatedPath('e2e-local', byAuthor, 'author-ada'), '/v1/data/query/e2e-local/post?perspective=drafts&limit=200&filter[author][in]=author-ada&order=_updatedAt:desc')
  assert.equal(relatedPath('e2e-local', byCategory, 'category-news', true), '/v1/data/query/e2e-local/post?perspective=published&limit=200&filter[categories][in]=category-news&order=_updatedAt:desc')
  assert.equal(
    relatedPath('ci', {type: 'post', by: 'content.author', orderings: [{field: 'title', direction: 'asc'}, {field: '_createdAt', direction: 'desc'}]}, 'a b'),
    '/v1/data/query/ci/post?perspective=drafts&limit=200&filter[content.author][in]=a%20b&order=title:asc,_createdAt:desc',
  )
})

test('pointsVia: a bare id, a {_ref}, an item of an array, through `content.` and into an object; another field does not count', () => {
  assert.ok(pointsVia({author: 'author-ada'}, 'author', 'author-ada'))
  assert.ok(pointsVia({author: 'author-ada'}, 'content.author', 'author-ada'))
  assert.ok(pointsVia({author: {_type: 'reference', _ref: 'author-ada'}}, 'author', 'author-ada'))
  assert.ok(pointsVia({categories: [{_key: 'a', _type: 'reference', _ref: 'category-tech'}, {_key: 'b', _type: 'reference', _ref: 'category-news'}]}, 'categories', 'category-news'))
  assert.ok(pointsVia({categories: ['category-news']}, 'categories', 'category-news'))
  assert.ok(pointsVia({cta: {page: 'post-01'}}, 'cta.page', 'post-01'))
  assert.equal(pointsVia({reviewer: 'author-ada', author: 'author-alan'}, 'author', 'author-ada'), false)
  assert.equal(pointsVia({categories: [{_ref: 'category-news-2'}]}, 'categories', 'category-news'), false)
  assert.equal(pointsVia({}, 'author', 'author-ada'), false)
  assert.equal(pointsVia(null, 'author', 'author-ada'), false)
})

test('live: a doc that starts pointing here joins at its place, one listed keeps its place, one pointing away leaves', () => {
  const a = doc('post-a', {author: 'author-ada', title: 'Alpha', _updatedAt: '2026-11-03T00:00:00Z'})
  const c = doc('post-c', {author: 'author-ada', title: 'Charlie', _updatedAt: '2026-11-01T00:00:00Z'})
  const rows = [a, c]
  // Last edited first: a newer one goes on top, an unsaved one (no time yet) too, an older one last.
  const b = doc('post-b', {author: 'author-ada', title: 'Bravo', _updatedAt: '2026-11-02T00:00:00Z'})
  assert.deepEqual(foldRelated(rows, b, byAuthor, 'author-ada').map((d) => d._id), ['post-a', 'post-b', 'post-c'])
  assert.deepEqual(foldRelated(rows, doc('post-new', {author: 'author-ada', _updatedAt: ''}, ''), byAuthor, 'author-ada').map((d) => d._id), ['post-new', 'post-a', 'post-c'])
  assert.deepEqual(foldRelated(rows, doc('post-old', {author: 'author-ada', _updatedAt: '2026-10-01T00:00:00Z'}), byAuthor, 'author-ada').map((d) => d._id), ['post-a', 'post-c', 'post-old'])
  // The declared order: by title.
  const byTitle: Related = {...byAuthor, orderings: [{field: 'title', direction: 'asc'}]}
  assert.deepEqual(foldRelated(rows, b, byTitle, 'author-ada').map((d) => d.title), ['Alpha', 'Bravo', 'Charlie'])
  // Listed already: the new values, the same place (a row does not jump while its title is typed).
  const renamed = {...c, title: 'Aardvark', _updatedAt: '2026-11-09T00:00:00Z'}
  assert.deepEqual(foldRelated(rows, renamed, byTitle, 'author-ada'), [a, renamed])
  // No title yet (a new post): where Barkpark's order puts a missing value, last ascending and first descending.
  const untitled = doc('post-u', {author: 'author-ada'})
  assert.deepEqual(foldRelated(rows, untitled, byTitle, 'author-ada').map((d) => d._id), ['post-a', 'post-c', 'post-u'])
  assert.deepEqual(foldRelated([c, a], untitled, {...byAuthor, orderings: [{field: 'title', direction: 'desc'}]}, 'author-ada').map((d) => d._id), ['post-u', 'post-c', 'post-a'])
  // Its reference now points elsewhere, or is gone: the row leaves.
  assert.deepEqual(foldRelated(rows, {...a, author: 'author-alan'}, byAuthor, 'author-ada'), [c])
  assert.deepEqual(foldRelated(rows, {...a, author: undefined}, byAuthor, 'author-ada'), [c])
  // Nothing to do: the same array (no redraw), for another type, a doc pointing elsewhere, the same doc, the open doc itself.
  assert.equal(foldRelated(rows, {...b, _type: 'author'}, byAuthor, 'author-ada'), rows)
  assert.equal(foldRelated(rows, {...b, author: 'author-alan'}, byAuthor, 'author-ada'), rows)
  assert.equal(foldRelated(rows, a, byAuthor, 'author-ada'), rows)
  assert.equal(foldRelated(rows, {...b, _publishedId: 'author-ada'}, byAuthor, 'author-ada'), rows)
  assert.deepEqual(dropRelated(rows, 'post-a'), [c])
  assert.equal(dropRelated(rows, 'post-zzz'), rows)
})

test('live, an array of references: an item added lists the doc, the item removed takes it away', () => {
  const tagged = doc('post-a', {categories: [{_key: 'k1', _type: 'reference', _ref: 'category-news'}]})
  assert.deepEqual(foldRelated([], tagged, byCategory, 'category-news'), [tagged])
  assert.deepEqual(foldRelated([tagged], {...tagged, categories: [{_key: 'k2', _type: 'reference', _ref: 'category-tech'}]}, byCategory, 'category-news'), [])
})

test('a row never leads to "not found": one the server does not have yet shows only while its pane is open; each doc once', () => {
  const saved = doc('post-a', {author: 'author-ada'})
  const unsaved = doc('post-new', {author: 'author-ada', _updatedAt: ''}, '')
  const none = () => undefined
  assert.deepEqual(shownRelated([unsaved, saved, saved], byAuthor, 'author-ada', none, (id) => id === 'post-new').map((d) => d._id), ['post-new', 'post-a'])
  assert.deepEqual(shownRelated([unsaved, saved], byAuthor, 'author-ada', none, () => false).map((d) => d._id), ['post-a'])
  // What this browser holds is the truth: typed away from here (not saved yet) the row is gone; deleted, too.
  assert.deepEqual(shownRelated([saved], byAuthor, 'author-ada', () => ({...saved, author: 'author-alan'}), () => false), [])
  assert.deepEqual(shownRelated([saved], byAuthor, 'author-ada', () => null, () => false), [])
  const newer = {...saved, title: 'Typed just now'}
  assert.deepEqual(shownRelated([saved], byAuthor, 'author-ada', () => newer, () => false), [newer])
})

test('"Add item" presets the reference: the id in a reference field, one keyed item more in an array, over the template', () => {
  assert.equal(referenceKind(post, 'author'), 'reference')
  assert.equal(referenceKind(post, 'content.author'), 'reference')
  assert.equal(referenceKind(post, 'categories'), 'array')
  assert.equal(referenceKind(post, 'cta.page'), 'reference')
  assert.equal(referenceKind(post, 'title'), null)
  assert.equal(referenceKind(post, 'tags'), null)
  assert.equal(referenceKind(post, 'nope'), null)
  assert.equal(referenceKind(undefined, 'author'), null)
  // A reference: this document, whatever the template had there (the "Post by Alan Turing" template).
  assert.deepEqual(referencePreset(post, 'author', 'author-ada', {author: 'author-alan', featured: false}), {author: 'author-ada'})
  assert.deepEqual(referencePreset(post, 'content.author', 'author-ada'), {author: 'author-ada'})
  // An array: the template's items stay, one keyed reference is added; never twice.
  const had = [{_key: 'k1', _type: 'reference', _ref: 'category-tech'}]
  assert.deepEqual(referencePreset(post, 'categories', 'category-news', {categories: had}, () => 'k2'), {categories: [...had, {_key: 'k2', _type: 'reference', _ref: 'category-news'}]})
  assert.deepEqual(referencePreset(post, 'categories', 'category-news', {}, () => 'k2'), {categories: [{_key: 'k2', _type: 'reference', _ref: 'category-news'}]})
  assert.deepEqual(referencePreset(post, 'categories', 'category-tech', {categories: had}, () => 'k2'), {categories: had})
  // Inside an object: the whole top-level field, the template's other subfields kept.
  assert.deepEqual(referencePreset(post, 'cta.page', 'post-01', {cta: {kind: 'internal'}}), {cta: {kind: 'internal', page: 'post-01'}})
  // No reference field: nothing is preset (and nothing is created).
  assert.equal(referencePreset(post, 'title', 'author-ada'), null)
})

test('creationAllowed: every way to start the type, only the named templates, or none', () => {
  const choices = [{id: 'post'}, {id: 'post-by-alan'}]
  assert.deepEqual(creationChoices(choices, true), choices)
  assert.deepEqual(creationChoices(choices, ['post-by-alan']), [{id: 'post-by-alan'}])
  assert.deepEqual(creationChoices(choices, false), [])
})

test('it holds no value: a declaration is no field (Barkpark refuses an unknown field type), and a preset names only the new document\'s reference field', () => {
  assert.equal((FIELD_TYPES as readonly string[]).includes('incomingReferences'), false)
  const [decl] = parseIncoming([{name: 'posts', types: [{type: 'post', by: 'author'}], value: 'x', fields: [{name: 'x', type: 'string'}], validation: {required: true}}])
  assert.deepEqual(Object.keys(decl!).sort(), ['creationAllowed', 'name', 'title', 'types'])
  // The author fixture's fields are untouched by its lists: nothing named after one.
  assert.equal(author.fields.some((f) => f.name === 'posts' || f.type === 'incomingReferences'), false)
  assert.deepEqual(Object.keys(referencePreset(post, 'author', 'author-ada', {title: 'From a template'})!), ['author'])
})

test("a published row matched in place of a draft that points elsewhere is not a row (Barkpark's drafts perspective answers with it)", () => {
  const draft = {...doc('post-d', {author: 'author-ada'}), _id: 'drafts.post-d', _draft: true}
  const plain = doc('post-p', {author: 'author-ada'})
  const shadowed = doc('post-s', {author: 'author-ada', title: 'Published title'}) // its draft names Alan
  const rows = [draft, plain, shadowed]
  // Only published rows can be one; they are asked about by their drafts. ids, in batches.
  assert.deepEqual(shadowable(rows), ['post-p', 'post-s'])
  assert.deepEqual(draftsPaths('e2e-local', 'post', ['post-p', 'post s', 'post-3'], 2), [
    '/v1/data/query/e2e-local/post?perspective=drafts&limit=2&filter[_id][in]=drafts.post-p,drafts.post%20s',
    '/v1/data/query/e2e-local/post?perspective=drafts&limit=2&filter[_id][in]=drafts.post-3',
  ])
  assert.deepEqual(draftsPaths('e2e-local', 'post', []), [])
  assert.deepEqual(unshadowed(rows, ['post-s']), [draft, plain])
  // A draft row is the document itself, whatever the answer names.
  assert.deepEqual(unshadowed(rows, ['post-d']), rows)
  assert.equal(unshadowed(rows, []), rows)
})
