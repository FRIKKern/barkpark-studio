// task-28470f0d0ace566c: the Restore card shows a kept edit it could not put back as the text typed.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fieldNames, keptText} from './kept-text.ts'

const blk = (key: string, ...texts: string[]) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: texts.map((text, i) => ({_type: 'span', _key: `${key}${i}`, text, marks: []}))})

test('a kept block as its text, a list as its paragraphs, a string as it is; anything else shows nothing', () => {
  assert.equal(keptText(blk('b', 'Start ', 'text one')), 'Start text one')
  assert.equal(keptText([blk('a', 'One'), {_type: 'image', _key: 'i'}, blk('b', 'Two')]), 'One\nTwo')
  assert.equal(keptText('A title'), 'A title')
  assert.equal(keptText(4), '')
})

test('the card names each field once: two kept blocks of one field read "Body", not "Body, Body"', () => {
  const labels = {body: 'Body', title: 'Title'}
  assert.equal(fieldNames(['body[_key=="a"]', 'body[_key=="b"]'], labels), 'Body')
  assert.equal(fieldNames(['title', 'body[_key=="a"]', 'body[_key=="b"]'], labels), 'Title, Body')
  assert.equal(fieldNames(['gone[_key=="a"]'], labels), 'gone[_key=="a"]')
})
