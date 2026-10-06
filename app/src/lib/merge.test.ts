// J06's text merge and caret mapping (node --test).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mapCaret, merge3, unapply} from './merge.ts'

test('merge3 keeps both edits', () => {
  assert.equal(merge3('Fixture post', 'bbb Fixture post', 'Fixture post aaa'), 'bbb Fixture post aaa')
  assert.equal(merge3('abc', 'abc', 'abXc'), 'abXc')
  assert.equal(merge3('abc', 'aYbc', 'abc'), 'aYbc')
})

test('mapCaret follows the text it sits in', () => {
  assert.equal(mapCaret('bbb post', 'bbb post aaa', 4), 4) // change after the caret
  assert.equal(mapCaret('post aaa', 'bbb post aaa', 8), 12) // change before it
})

test('unapply undoes my step, keeps text merged in since', () => {
  // I typed " aaa"; someone's "bbb " merged in after.
  assert.equal(unapply('post A aaa', 'post A', 'bbb post A aaa'), 'bbb post A')
})
