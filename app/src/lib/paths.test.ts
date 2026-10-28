import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyPaths, getPath, keyedPath, segments, setPath, within} from './paths.ts'

test('setPath sets a nested value and keeps its siblings', () => {
  assert.deepEqual(setPath({seo: {metaTitle: 'a', metaDescription: 'd'}}, 'seo.metaTitle', 'b'), {seo: {metaTitle: 'b', metaDescription: 'd'}})
})
test('setPath creates missing parents and removes on undefined', () => {
  assert.deepEqual(setPath({}, 'seo.metaTitle', 'x'), {seo: {metaTitle: 'x'}})
  assert.deepEqual(setPath({seo: {metaTitle: 'x', metaDescription: 'd'}}, 'seo.metaTitle', undefined), {seo: {metaDescription: 'd'}})
})
test('applyPaths applies in order; within matches self and descendants only', () => {
  assert.deepEqual(applyPaths({title: 't'}, [['seo.metaTitle', 'a'], ['title', 'u']]), {title: 'u', seo: {metaTitle: 'a'}})
  assert.equal(within('seo.metaTitle', 'seo'), true)
  assert.equal(within('seo', 'seo'), true)
  assert.equal(within('seoX', 'seo'), false)
})

test('an array item by its key: get, set (whole and inside), remove; a missing key changes nothing, as Barkpark', () => {
  const doc = {title: 't', body: [{_key: 'b1', _type: 'block', children: [{_key: 's1', text: 'one'}]}, {_key: 'b2', _type: 'block', children: [{_key: 's2', text: 'two'}]}]}
  assert.deepEqual(segments('body[_key=="b1"].children[_key=="s1"].text'), [{name: 'body'}, {key: 'b1'}, {name: 'children'}, {key: 's1'}, {name: 'text'}])
  assert.equal(keyedPath('body', 'b2'), 'body[_key=="b2"]')
  assert.equal(getPath(doc, 'body[_key=="b2"].children[_key=="s2"].text'), 'two')
  assert.equal(getPath(doc, 'body[_key=="nope"]'), undefined)
  const b2 = {_key: 'b2', _type: 'block', children: [{_key: 's2', text: 'TWO'}]}
  assert.deepEqual(setPath(doc, 'body[_key=="b2"]', b2).body, [doc.body[0], b2])
  assert.equal(getPath(setPath(doc, 'body[_key=="b1"].children[_key=="s1"].text', 'ONE'), 'body[_key=="b1"].children[_key=="s1"].text'), 'ONE')
  assert.deepEqual(setPath(doc, 'body[_key=="b1"]', undefined).body, [doc.body[1]])
  assert.deepEqual(setPath(doc, 'body[_key=="nope"]', b2), doc)
  // The original is never changed.
  assert.equal(doc.body[1]!.children[0]!.text, 'two')
  assert.equal(within('body[_key=="b1"]', 'body'), true)
  assert.equal(within('body[_key=="b1"].children', 'body[_key=="b1"]'), true)
  assert.equal(within('bodyX', 'body'), false)
})
