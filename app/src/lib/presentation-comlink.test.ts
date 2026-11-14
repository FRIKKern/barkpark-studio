// What a preview frame's comlink messages may make the studio do (lib/presentation-comlink.ts).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fieldPath, focusPane, focusTarget, forget, framePath, hear, liveResult, loaderListen, mayRead, pageDocuments, previewQueryPath, queryKey, QUERIES_MAX, readsDocument, refusedMessage, type QueryBook, type SourceMap} from './presentation-comlink.ts'
import {parseDocSegments} from './panes.ts'

const ORIGIN = 'http://localhost:3537'

test('refusedMessage: comlink is heard from the frame on its own origin only; other messages pass', () => {
  const frame = {}
  const syn = {domain: 'sanity/comlink', type: 'comlink/handshake/syn-ack', from: 'visual-editing', to: 'presentation'}
  assert.equal(refusedMessage({origin: ORIGIN, source: frame, data: syn}, frame, ORIGIN), false)
  // The frame followed a link to another site: same window, another origin.
  assert.equal(refusedMessage({origin: 'https://evil.example', source: frame, data: syn}, frame, ORIGIN), true)
  assert.equal(refusedMessage({origin: ORIGIN, source: {}, data: syn}, frame, ORIGIN), true)
  assert.equal(refusedMessage({origin: ORIGIN, source: frame, data: {...syn, domain: 'sanity/channels'}}, null, ORIGIN), true)
  // Not comlink (our bridge, a browser extension): not this guard's to stop.
  assert.equal(refusedMessage({origin: 'https://evil.example', source: {}, data: {bp: 'preview', type: 'hello'}}, frame, ORIGIN), false)
})

test('focusTarget → fieldPath → focusPane: a visual-editing/focus payload opens its document on the field', () => {
  const open = (data: unknown, doc?: unknown) => {
    const hit = focusTarget(data)
    return hit && focusPane({id: hit.id, type: hit.type ?? 'post', path: hit.path && fieldPath(hit.path, doc)})
  }
  assert.equal(open({id: 'post-01', type: 'post', path: 'title', baseUrl: 'http://x', projectId: 'p', dataset: 'd'}), 'post;post-01,path=title')
  // A draft's (or a release version's) id is its document's.
  assert.equal(open({id: 'drafts.post-01', type: 'post', path: 'seo.metaTitle'}), 'post;post-01,path=seo.metaTitle')
  assert.equal(open({id: 'versions.r1.post-01', type: 'post'}), 'post;post-01')
  // An array item by its key, as #1140's links: the pane reads the same path back.
  const keyed = open({id: 'post-03', type: 'post', path: 'links[_key=="l1"].title'})
  assert.equal(keyed, 'post;post-03,path=links[_key=="l1"].title')
  assert.equal(parseDocSegments([keyed!.split(';')[1]!], 'post')[0]!.path, 'links[_key=="l1"].title')
  // By index (a source map without keys): the item's key from the document, else its array.
  const doc = {links: [{_key: 'l1', title: 'a'}, {_key: 'l2', title: 'b'}], tags: ['x', 'y'], body: {blocks: [{id: 'h1'}, {id: 'p1', content: [{value: 'text'}]}]}}
  assert.equal(open({id: 'post-03', type: 'post', path: 'links[1].title'}, doc), 'post;post-03,path=links[_key=="l2"].title')
  assert.equal(open({id: 'post-03', type: 'post', path: 'links[1].title'}), 'post;post-03,path=links')
  assert.equal(open({id: 'post-03', type: 'post', path: 'tags[1]'}, doc), 'post;post-03,path=tags')
  // Barkpark's block body: the block, as the bridge's `body[_key=="p1"]`.
  assert.equal(open({id: 'post-01', type: 'post', path: 'body.blocks[1].content[0].value'}, doc), 'post;post-01,path=body[_key=="p1"]')
  // Nothing rides into the pane chain: a path that is not one is dropped, an id or type that is not one refused.
  assert.equal(open({id: 'post-01', type: 'post', path: 'title;author-alan,type=author|x'}), 'post;post-01')
  assert.equal(open({id: 'post-01', type: 'post', path: 'links[_key=="l1,view=json"].title'}), 'post;post-01')
  assert.equal(open({id: 'post-01;author-alan', type: 'post', path: 'title'}), null)
  assert.equal(open({id: 'post-01', type: 'post,view=json', path: 'title'}), null)
  assert.equal(open({id: 7, type: 'post'}), null)
  assert.equal(open('post-01'), null)
})

test('framePath: the studio follows the frame on its own origin only', () => {
  assert.equal(framePath('/posts/a?x=1', ORIGIN), '/posts/a?x=1')
  assert.equal(framePath(`${ORIGIN}/authors/b`, ORIGIN), '/authors/b')
  assert.equal(framePath('https://evil.example/posts/a', ORIGIN), null)
  assert.equal(framePath('//evil.example/posts/a', ORIGIN), null)
  assert.equal(framePath('javascript:alert(1)', ORIGIN), null)
  assert.equal(framePath({url: '/'}, ORIGIN), null)
})

test('pageDocuments: by published id, once each, schema types only', () => {
  const docs = [{_id: 'drafts.post-01', _type: 'post'}, {_id: 'post-01', _type: 'post'}, {_id: 'author-alan', _type: 'author'}, {_id: 'x', _type: 'system.secret'}, {_id: 'a;b', _type: 'post'}, null, 'post-02']
  assert.deepEqual(pageDocuments(docs, new Set(['post', 'author'])), [{_id: 'post-01', _type: 'post'}, {_id: 'author-alan', _type: 'author'}])
  assert.deepEqual(pageDocuments('nope', new Set(['post'])), [])
})

const listen = (over: Record<string, unknown> = {}) => ({projectId: 'p', dataset: 'e2e-local', perspective: 'drafts', query: '*[_type == "post" && slug.current == $slug][0]{title}', params: {slug: 'a'}, heartbeat: 20_000, ...over})

test('loader queries: one read per query, params in any order; the heartbeat keeps it; unheard ones go', () => {
  assert.equal(queryKey('drafts', 'q', {a: 1, b: {d: 1, c: 2}}), queryKey('drafts', 'q', {b: {c: 2, d: 1}, a: 1}))
  assert.notEqual(queryKey('drafts', 'q', {a: 1}), queryKey('published', 'q', {a: 1}))
  const book: QueryBook = new Map()
  const first = hear(book, loaderListen(listen())!, 0)
  assert.equal(first.fresh, true)
  // The loader repeats every listen on its heartbeat and whenever a query is added: not a new read.
  assert.deepEqual(hear(book, loaderListen(listen())!, 15_000), {key: first.key, fresh: false})
  assert.equal(hear(book, loaderListen(listen({params: {slug: 'b'}}))!, 15_000).fresh, true)
  assert.equal(book.size, 2)
  // Two heartbeats unheard (the page moved on), or another perspective than the tool's: forgotten.
  assert.deepEqual(forget(book, 15_000 + 39_000, 'drafts'), [])
  assert.deepEqual(forget(book, 15_000 + 41_000, 'drafts').length, 2)
  hear(book, loaderListen(listen())!, 0)
  assert.equal(forget(book, 1, 'published').length, 1)
  // A page cannot make the studio follow queries without end: the one heard longest ago gives way,
  // and its reads are counted against a minute's allowance.
  book.clear()
  for (let i = 0; i < QUERIES_MAX + 5; i++) hear(book, loaderListen(listen({params: {slug: `s${i}`}}))!, i)
  assert.equal(book.size, QUERIES_MAX)
  assert.equal(book.has(queryKey('drafts', listen().query, {slug: 's0'})), false)
  assert.equal(book.has(queryKey('drafts', listen().query, {slug: `s${QUERIES_MAX + 4}`})), true)
  const stamps: number[] = []
  assert.deepEqual([mayRead(stamps, 0, 2), mayRead(stamps, 10, 2), mayRead(stamps, 20, 2), mayRead(stamps, 60_001, 2)], [true, true, false, true])
})

test('loaderListen + previewQueryPath: only a GROQ read of this dataset, in drafts or published', () => {
  assert.equal(loaderListen(listen({query: ''})), null)
  assert.equal(loaderListen(listen({query: 'x'.repeat(8_001)})), null)
  assert.equal(loaderListen(listen({params: ['a']})), null)
  assert.equal(loaderListen(listen({params: {'a&perspective=raw': 1}})), null)
  assert.equal(loaderListen(listen({params: {a: 'x'.repeat(4_000)}})), null)
  assert.equal(loaderListen(listen({heartbeat: 5}))!.heartbeat, false)
  const run = previewQueryPath(listen(), 'e2e-local')
  assert.ok('path' in run)
  const url = new URL(run.path, 'http://bp')
  assert.equal(url.pathname, '/v2025-02-19/data/query/e2e-local')
  assert.deepEqual(Object.fromEntries(url.searchParams), {query: listen().query, $slug: '"a"', perspective: 'drafts', resultSourceMap: 'withKeyArraySelector'})
  // A value cannot add a parameter of its own.
  const sly = previewQueryPath(listen({params: {slug: 'a&perspective=raw&token=x'}}), 'e2e-local')
  assert.ok('path' in sly && new URL(sly.path, 'http://bp').searchParams.get('perspective') === 'drafts' && !new URL(sly.path, 'http://bp').searchParams.has('token'))
  assert.ok('error' in previewQueryPath(listen({perspective: 'raw'}), 'e2e-local'))
  assert.ok('error' in previewQueryPath(listen({dataset: 'production'}), 'e2e-local'))
  assert.ok('error' in previewQueryPath({query: 7}, 'e2e-local'))
})

test('liveResult: the typed value lands in the result through the source map; shapes that differ stay as read', () => {
  const map: SourceMap = {
    documents: [{_id: 'author-alan', _type: 'author'}, {_id: 'drafts.post-01', _type: 'post'}],
    paths: ["$['_id']", "$['name']", "$['title']", "$['slug']['current']", "$['links'][?(@._key=='l1')]['title']", "$['rating']"],
    mappings: {
      "$['_id']": {type: 'value', source: {type: 'documentValue', document: 1, path: 0}},
      "$['title']": {type: 'value', source: {type: 'documentValue', document: 1, path: 2}},
      "$['slug']": {type: 'value', source: {type: 'documentValue', document: 1, path: 3}},
      "$['author']['name']": {type: 'value', source: {type: 'documentValue', document: 0, path: 1}},
      "$['links'][0]['title']": {type: 'value', source: {type: 'documentValue', document: 1, path: 4}},
      "$['rating']": {type: 'value', source: {type: 'documentValue', document: 1, path: 5}},
    },
  }
  const result = {_id: 'post-01', title: 'Old', slug: 'old', author: {name: 'Alan'}, links: [{_key: 'l1', title: 'A'}], rating: 1}
  // The studio's copy: Barkpark-shaped (a slug is a string), the draft's id, an unsaved title.
  const post = {_id: 'drafts.post-01', title: 'Old typed', slug: 'old', links: [{_key: 'l1', title: 'A2'}], rating: 4}
  const out = liveResult(result, map, (id) => (id === 'post-01' ? post : undefined))
  assert.deepEqual(out, {_id: 'post-01', title: 'Old typed', slug: 'old', author: {name: 'Alan'}, links: [{_key: 'l1', title: 'A2'}], rating: 4})
  assert.equal(result.title, 'Old')
  // Nothing open, nothing changed: the result itself.
  assert.equal(liveResult(result, map, () => undefined), result)
  assert.equal(readsDocument(map, 'post-01'), true)
  assert.equal(readsDocument(map, 'post-02'), false)
})
