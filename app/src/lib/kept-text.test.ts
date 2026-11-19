// task-28470f0d0ace566c: the Restore card shows a kept edit it could not put back as the text typed.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {keptText} from './kept-text.ts'

const blk = (key: string, ...texts: string[]) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: texts.map((text, i) => ({_type: 'span', _key: `${key}${i}`, text, marks: []}))})

test('a kept block as its text, a list as its paragraphs, a string as it is; anything else shows nothing', () => {
  assert.equal(keptText(blk('b', 'Start ', 'text one')), 'Start text one')
  assert.equal(keptText([blk('a', 'One'), {_type: 'image', _key: 'i'}, blk('b', 'Two')]), 'One\nTwo')
  assert.equal(keptText('A title'), 'A title')
  assert.equal(keptText(4), '')
})
