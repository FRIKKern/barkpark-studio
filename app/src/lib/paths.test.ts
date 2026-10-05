import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyPaths, setPath, within} from './paths.ts'

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
