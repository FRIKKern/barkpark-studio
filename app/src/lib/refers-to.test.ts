import assert from 'node:assert/strict'
import {test} from 'node:test'
import {refersTo} from './refers-to.ts'

test('a reference anywhere in a doc, plain or Sanity-shaped; its own id is not one', () => {
  assert.equal(refersTo({_id: 'author-alan', name: 'Alan'}, 'author-alan'), false)
  assert.equal(refersTo({author: 'author-alan'}, 'author-alan'), true)
  assert.equal(refersTo({links: [{target: {_type: 'reference', _ref: 'author-alan'}}]}, 'author-alan'), true)
  assert.equal(refersTo({author: 'author-grace', title: 'Alan'}, 'author-alan'), false)
})

test('a reference inside a richText body counts, as Barkpark counts it (#22593); a plain link does not', () => {
  const para = (...content: unknown[]) => ({id: 'p', type: 'paragraph', content})
  const wikilink = {type: 'wikilink', target: 'author-ada', docId: 'author-ada', children: [{type: 'text', value: 'Ada'}]}
  // Both shapes a richText value takes: the block editor's wrapper, and a bare list.
  assert.equal(refersTo({body: {blocks: [para(wikilink)], html: '<p>Ada</p>'}}, 'author-ada'), true)
  assert.equal(refersTo({body: [para(wikilink)]}, 'author-ada'), true)
  // An annotation or inline object carrying a _ref, an object block with a reference field.
  assert.equal(refersTo({body: {blocks: [para({type: 'text', value: 'x', marks: [{type: 'internalLink', _ref: 'author-ada'}]})]}}, 'author-ada'), true)
  assert.equal(refersTo({body: {blocks: [{id: 'c', type: 'authorCard', author: {_type: 'reference', _ref: 'author-ada'}}]}}, 'author-ada'), true)
  // A plain URL link is not a reference, even to a page about her.
  assert.equal(refersTo({body: {blocks: [para({type: 'link', href: 'https://example.com/author-ada', children: [{type: 'text', value: 'Ada'}]})]}}, 'author-ada'), false)
})
