// J06's text merge and caret mapping (node --test).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mapCaret, merge3, mergeList3, onto, revert, unapply} from './merge.ts'

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

test('mergeList3 keeps their reorder while I edit an item', () => {
  // Unkeyed strings: I typed into "two"; they moved "one" below it.
  assert.deepEqual(mergeList3(['one', 'two', 'three'], ['one', 'two-edited', 'three'], ['two', 'one', 'three']), ['two-edited', 'one', 'three'])
  // Keyed objects: my edit, my add after k2, their reorder and their add, all kept; my remove too.
  const o = (k: string, v: string) => ({_key: k, v})
  assert.deepEqual(
    mergeList3([o('k1', 'a'), o('k2', 'b'), o('k3', 'c')], [o('k2', 'B'), o('kn', 'new'), o('k3', 'c')], [o('k3', 'c'), o('k2', 'b'), o('k1', 'a'), o('kt', 't')]),
    [o('k3', 'c'), o('k2', 'B'), o('kn', 'new'), o('kt', 't')],
  )
  // Unkeyed shape change of mine can't be placed: null (the caller keeps ours).
  assert.equal(mergeList3(['a', 'b'], ['a', 'b', 'c'], ['b', 'a']), null)
})

test('mergeList3: an item I added and typed into at once keeps my typing (J33)', () => {
  // Drawn before my add; the cache already holds the add ("Read more") come back; mine has the title typed.
  const l = (k: string, title: string) => ({_key: k, title})
  assert.deepEqual(mergeList3([l('l1', 'a')], [l('l1', 'a'), l('n1', 'Barkpark')], [l('l1', 'a'), l('n1', 'Read more')]), [l('l1', 'a'), l('n1', 'Barkpark')])
  // Their edit elsewhere in the list still stands.
  assert.deepEqual(mergeList3([l('l1', 'a')], [l('l1', 'a'), l('n1', 'Barkpark')], [l('l1', 'A'), l('n1', 'Read more')]), [l('l1', 'A'), l('n1', 'Barkpark')])
})

test('mergeList3: I moved an item while they typed in another', () => {
  assert.deepEqual(mergeList3(['one', 'two', 'three'], ['two', 'one', 'three'], ['one', 'two-by-A', 'three']), ['two-by-A', 'one', 'three'])
})

test('onto: a change made from an older drawing goes onto what came in since', () => {
  // B dropped "one" below "two" on a list drawn before A's words arrived.
  assert.deepEqual(onto(['one', 'two', 'three'], ['two', 'one', 'three'], ['one', 'two-by-A', 'three']), ['two-by-A', 'one', 'three'])
  assert.deepEqual(onto(['a'], ['b'], ['a']), ['b'])
  assert.equal(onto(1, 2, 3), 2)
})

test('revert undoes my step, never what another editor set since', () => {
  assert.equal(revert('g', 'b', 'g'), 'b') // my select change, still mine
  assert.equal(revert('g', 'b', 'a'), 'a') // they set Alpha since: theirs stays
  assert.equal(revert(true, false, false), false)
  assert.equal(revert('post A aaa', 'post A', 'bbb post A aaa'), 'bbb post A') // text: mine out, theirs kept
  // I removed One; they added Remote: One comes back, Remote stays.
  const one = {_key: '1', t: 'One'}, two = {_key: '2', t: 'Two'}, remote = {_key: 'r', t: 'Remote'}
  assert.deepEqual(revert([two], [one, two], [two, remote]), [one, two, remote])
  // I added Three; they added Remote: undo drops Three only.
  const three = {_key: '3', t: 'Three'}
  assert.deepEqual(revert([one, three], [one], [one, three, remote]), [one, remote])
})
