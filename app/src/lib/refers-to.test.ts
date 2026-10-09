import assert from 'node:assert/strict'
import {test} from 'node:test'
import {refersTo} from './refers-to.ts'

test('a reference anywhere in a doc, plain or Sanity-shaped; its own id is not one', () => {
  assert.equal(refersTo({_id: 'author-alan', name: 'Alan'}, 'author-alan'), false)
  assert.equal(refersTo({author: 'author-alan'}, 'author-alan'), true)
  assert.equal(refersTo({links: [{target: {_type: 'reference', _ref: 'author-alan'}}]}, 'author-alan'), true)
  assert.equal(refersTo({author: 'author-grace', title: 'Alan'}, 'author-alan'), false)
})
