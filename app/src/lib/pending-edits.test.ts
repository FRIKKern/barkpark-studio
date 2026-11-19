// B11 widen: kept form edits are replayed, asked about, or dropped against the doc as it is now.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Doc, Schema} from './data.ts'
import {combine, judge, restoreBlock, restoreValue, type Pending} from './pending-edits.ts'

const p: Pending = {at: 1, type: 'post', rev: 'r1', fields: [['title', 'Hello world'], ['rating', 4]], base: [['title', 'Hello'], ['rating', 3]], tab: 'x'}
const doc = (rev: string, title: string, rating: number) => ({_rev: rev, title, rating}) as unknown as Doc

test('same rev replays; a newer rev asks; what the server already says is dropped', () => {
  assert.deepEqual(judge(p, doc('r1', 'Hello', 3)), {kind: 'replay', fields: p.fields})
  assert.deepEqual(judge(p, doc('r2', 'Hello', 4)), {kind: 'ask', fields: [['title', 'Hello world']]})
  assert.deepEqual(judge(p, doc('r2', 'Hello world', 4)), {kind: 'drop'})
})

test('restore merges text with what changed since; other values are ours', () => {
  assert.equal(restoreValue(p, 'title', 'Hello world', doc('r2', 'Oh Hello', 5)), 'Oh Hello world')
  assert.equal(restoreValue(p, 'rating', 4, doc('r2', 'Hello', 5)), 4)
})

test('a field the schema dropped or retyped is never replayed, and still asked about', () => {
  const schema = {name: 'post', title: 'Post', fields: [{name: 'title', type: 'string'}, {name: 'rating', type: 'string'}]} as Schema
  // rating is now a string field: the kept 4 does not fit; same rev, but asked, not replayed.
  assert.deepEqual(judge(p, doc('r1', 'Hello', 3), schema), {kind: 'ask', fields: [['title', 'Hello world']], gone: ['rating']})
  assert.deepEqual(judge(p, doc('r1', 'Hello', 3), {...schema, fields: [{name: 'rating', type: 'number'}]} as Schema), {kind: 'ask', fields: [['rating', 4]], gone: ['title']})
})

test('two dead pages for one doc combine: the later edit of a field wins, the rev only when shared', () => {
  const a: Pending = {at: 1, type: 'post', rev: 'r1', fields: [['title', 'A'], ['excerpt', 'x']], base: [['title', 'T'], ['excerpt', 'e']], tab: 'a'}
  const b: Pending = {at: 2, type: 'post', rev: 'r2', fields: [['title', 'B']], base: [['title', 'A']], tab: 'b'}
  assert.deepEqual(combine([a, b]), {at: 2, type: 'post', rev: undefined, fields: [['title', 'B'], ['excerpt', 'x']], base: [['title', 'A'], ['excerpt', 'e']], tab: 'b'})
  assert.equal(combine([a, {...b, rev: 'r1'}])?.rev, 'r1')
})

test('restore over a rewrite that cannot merge puts mine back whole', () => {
  const kept: Pending = {at: 1, type: 'post', rev: 'r1', fields: [['title', 'Hello brave world']], base: [['title', 'Hello world']], tab: 'x'}
  assert.equal(restoreValue(kept, 'title', 'Hello brave world', doc('r2', 'Goodbye', 3)), 'Hello brave world')
})

// task-2c01c385ce7b51d0 review: a kept block's run goes on only over blocks new since the edit
// was made. A paragraph that was there then keeps every letter, whatever it shares with the block.
const blk = (key: string, text: string) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: [{_type: 'span', _key: `${key}s`, text, marks: []}]})
const texts = (v: unknown) => (v as {children: {text: string}[]}[]).map((b) => b.children.map((c) => c.text).join(''))
const restored = (base: string, mine: string, now: unknown[], keys?: string[]) => {
  const p: Pending = {at: 1, type: 'post', rev: 'r1', fields: [['body[_key=="b"]', blk('b', mine)]], base: [['body[_key=="b"]', blk('b', base)]], ...(keys && {keys: [['body', keys]]}), tab: 'x'}
  const r = restoreBlock(p, 'body[_key=="b"]', blk('b', mine), {_id: 'x', _type: 'post', body: now} as unknown as Doc)
  return r && texts(r[1])
}
for (const [name, base, mine, now, want] of [
  ['C11: they rewrote the block, mine deletes " world": "wonder world" stays whole', 'Hello world', 'Hello', [blk('b', 'Hi'), blk('c', 'Other'), blk('d', 'wonder world')], ['Hi', 'Other', 'wonder world']],
  ['C12: they rewrote the block, mine deletes "cat ": "my cat is here" stays whole', 'the cat sat', 'the sat', [blk('b', 'A dog'), blk('d', 'my cat is here')], ['Adog', 'my cat is here']],
  ['C14: they shortened the block, mine adds "!": it stays in the block, not after a later "text"', 'Start text', 'Start text!', [blk('b', 'Start'), blk('c', 'Middle para'), blk('d', 'Last para with text')], ['Start!', 'Middle para', 'Last para with text']],
  ['C2: they emptied the block: mine stays in it, not in a later paragraph sharing its letters', 'Start text', 'Start text one two three', [blk('a', 'Above'), blk('b', ''), blk('c', 'Stars at night'), blk('d', 'Extra text here')], ['Above', ' one two three', 'Stars at night', 'Extra text here']],
  ['C3: they shortened the block to "H": mine\'s "big" stays in it', 'Hello world', 'Hello big world', [blk('b', 'H'), blk('c', 'Other people'), blk('d', 'wonder world')], ['Hbig ', 'Other people', 'wonder world']],
  ['C8: a later paragraph quoting the block\'s text: mine stays in the block', 'Start text', 'Start text one', [blk('b', 'Start'), blk('c', 'Quote: Start text')], ['Start one', 'Quote: Start text']],
  ['C9: a one-letter block replaced: mine stays in it, not in "gamma a"', 'a', 'ab', [blk('b', 'x'), blk('c', 'alpha'), blk('d', 'gamma a')], ['xb', 'alpha', 'gamma a']],
] as [string, string, string, unknown[], string[]][])
  test(`restore of a kept block, ${name}`, () => assert.deepEqual(restored(base, mine, now, (now as {_key: string}[]).map((b) => b._key)), want))

test('restore of a kept block: the new blocks of their paste at its start are the run, the paragraph after them is not; with no keys kept, the block alone', () => {
  const now = [blk('a', 'Above'), blk('b', 'x'), blk('ny', 'y'), blk('nz', 'zStart text'), blk('c', 'Below')]
  assert.deepEqual(restored('Start text', 'Start text one two three', now, ['a', 'b', 'c']), ['Above', 'x', 'y', 'zStart text one two three', 'Below'])
  assert.deepEqual(restored('Start text', 'Start text one two three', now), ['Above', 'x one two three', 'y', 'zStart text', 'Below'])
})

test('two dead pages combine their block keys: a key either knew is not new', () => {
  const a: Pending = {at: 1, type: 'post', fields: [['body[_key=="b"]', 1]], base: [['body[_key=="b"]', 0]], keys: [['body', ['a', 'b']]], tab: 'a'}
  const b: Pending = {at: 2, type: 'post', fields: [['body[_key=="c"]', 1]], base: [['body[_key=="c"]', 0]], keys: [['body', ['b', 'c']]], tab: 'b'}
  assert.deepEqual(combine([a, b])?.keys, [['body', ['a', 'b', 'c']]])
  assert.equal(combine([{...a, keys: undefined}])?.keys, undefined)
})
