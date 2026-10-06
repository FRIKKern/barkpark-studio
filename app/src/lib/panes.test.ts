// Pane URLs in Sanity's format, split siblings included (J26): parse → print is identity.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {closeSplit, openAfter, panesPath, parsePanes, splitRight} from './panes.ts'

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
})
