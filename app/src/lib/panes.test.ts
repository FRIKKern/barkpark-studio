// Pane URLs in Sanity's format, split siblings included (J26): parse → print is identity.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {closeSplit, openAfter, panesPath, parsePanes, parseSingletonPanes, splitRight} from './panes.ts'

const round = (p: string) => panesPath(parsePanes(p.replace('/structure/', '')))

test('URLs round-trip', () => {
  for (const url of [
    '/structure/post;post-26',
    '/structure/post;post-26|,',
    '/structure/post;post-26|,view=json',
    '/structure/post;post-01;author-alan,type=author,parentRefPath=author',
    '/structure/post;post-01;author-alan,type=author,parentRefPath=author|,',
  ])
    assert.equal(round(url), url)
})

test('split, open a ref from the left side, close the split', () => {
  const one = parsePanes('post;post-26')
  assert.equal(splitRight(one, 2), '/structure/post;post-26|,')
  const two = parsePanes('post;post-26|,')
  assert.equal(openAfter(two, 2, {kind: 'doc', id: 'author-ada', type: 'author', parentRefPath: 'author'}), '/structure/post;post-26|,;author-ada,type=author,parentRefPath=author')
  assert.equal(closeSplit(two, 3), '/structure/post;post-26')
  assert.equal(closeSplit(two, 2), '/structure/post;post-26')
})

test('a focused field rides in the pane (J52), nested paths included', () => {
  for (const p of ['/structure/post;post-22,path=excerpt', '/structure/post;post-22,path=seo.metaTitle', '/structure/post;post-22;author-ada,type=author,parentRefPath=author,path=bio'])
    assert.equal(round(p), p)
  const [, , doc] = parsePanes('post;post-22,path=seo.metaTitle')
  assert.equal((doc as {path?: string}).path, 'seo.metaTitle')
  // A field inside an array item, as the router shows the URL (decoded) and as it encodes it.
  for (const url of ['post;post-03,path=links[_key=="l1"].title', `post;post-03,path=${encodeURIComponent('links[_key=="l1"].title')}`])
    assert.equal((parsePanes(url)[2] as {path?: string}).path, 'links[_key=="l1"].title')
})

test('B13: with no desk, a singleton type opens its one doc, and prints back the same', () => {
  const one = new Set(['siteSettings'])
  assert.deepEqual(JSON.parse(JSON.stringify(parseSingletonPanes('siteSettings', one))), [{kind: 'types'}, {kind: 'doc', id: 'siteSettings', type: 'siteSettings', node: 'siteSettings'}])
  for (const url of ['/structure/siteSettings', '/structure/siteSettings,inspect=history', '/structure/siteSettings|,', '/structure/siteSettings;post-01,type=post,parentRefPath=featured'])
    assert.equal(panesPath(parseSingletonPanes(url.replace('/structure/', ''), one)), url)
  assert.deepEqual(parseSingletonPanes('post;post-01', one), parsePanes('post;post-01'))
  // A list-style link (search, Copy URL) is the same one doc, params kept.
  assert.equal(panesPath(parseSingletonPanes('siteSettings;siteSettings,view=json', one)), '/structure/siteSettings,view=json')
  // Opened from the root row: the URL is the type alone.
  assert.equal(openAfter([{kind: 'types'}], 0, {kind: 'doc', id: 'siteSettings', type: 'siteSettings', node: 'siteSettings'}), '/structure/siteSettings')
})
