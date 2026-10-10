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

test('mine already in theirs (an answer lost, a beacon delivered) is not typed twice', () => {
  assert.equal(merge3('A day in the life', 'A day in the life of an editor', 'A day in the life of an editor, told twice'), 'A day in the life of an editor, told twice')
  assert.equal(merge3('Short excerpt', 'Short excerpt kept', 'Short excerpt kept, and more from someone else'), 'Short excerpt kept, and more from someone else')
  assert.equal(merge3('one two three', 'one three', 'one three four'), 'one three four') // a deletion already made
  // A real concurrent edit still merges.
  assert.equal(merge3('Hello', 'Hello world', 'Oh Hello'), 'Oh Hello world')
})

test('mine with nowhere to go (they rewrote the text it was in) is no merge, not a silent drop', () => {
  assert.equal(merge3('Short excerpt here.', 'Short mine excerpt here.', 'Completely rewritten elsewhere.'), null)
  assert.equal(merge3('Hello world', 'Hello brave world', 'Goodbye'), null)
  // An insertion at the end still finds its place.
  assert.equal(merge3('Short excerpt here.', 'Short excerpt here. mine', 'Completely rewritten elsewhere.'), 'Completely rewritten elsewhere. mine')
})
