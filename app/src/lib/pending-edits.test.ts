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

// task-2c01c385ce7b51d0 review, the lead's cannot-tell rule: a kept block's edit goes onto the
// server's version of the same block where the text it touched still stands, and into the new
// blocks right after it only where they are its split. Otherwise every server block stays as it is.
const blk = (key: string, text: string) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: [{_type: 'span', _key: `${key}s`, text, marks: []}]})
const texts = (v: unknown) => (v as {children: {text: string}[]}[]).map((b) => b.children.map((c) => c.text).join(''))
const restored = (base: string, mine: string, now: unknown[], keys?: string[]) => {
  const p: Pending = {at: 1, type: 'post', rev: 'r1', fields: [['body[_key=="b"]', blk('b', mine)]], base: [['body[_key=="b"]', blk('b', base)]], ...(keys && {keys: [['body', keys]]}), tab: 'x'}
  const r = restoreBlock(p, 'body[_key=="b"]', blk('b', mine), {_id: 'x', _type: 'post', body: now} as unknown as Doc)
  return r && texts(r[1])
}
const all = (now: unknown[]) => (now as {_key: string}[]).map((b) => b._key)
const SERVER = 'the server\'s blocks'
for (const [name, base, mine, now, keys, want] of [
  // Applied: the touched text stands in the same block, or in its split.
  ['a deletion whose run stands, their edit elsewhere in the block: applied', 'the cat sat', 'the sat', [blk('b', 'The cat sat down')], ['b'], ['The sat down']],
  ['their Enter splits the block, mine deletes in the second half: applied there', 'Start text here now', 'Start text now', [blk('b', 'Start text'), blk('r', ' here now')], ['b'], ['Start text', ' now']],
  ['their paste at its start (x, y, zStart text): the line goes after the block\'s text', 'Start text', 'Start text one two three', [blk('a', 'Above'), blk('b', 'x'), blk('ny', 'y'), blk('nz', 'zStart text'), blk('c', 'Below')], ['a', 'b', 'c'], ['Above', 'x', 'y', 'zStart text one two three', 'Below']],
  ['their new quote of the text after it, mine deletes: applied in the block, the quote as theirs', 'Start text', 'Start', [blk('b', 'Start text'), blk('q', 'Quote: Start text')], ['b'], ['Start', 'Quote: Start text']],
  ['their new quote of the text after it, mine inserts: applied in the block, the quote as theirs', 'Start text', 'Start text one', [blk('b', 'Start text'), blk('q', 'Quote: Start text')], ['b'], ['Start text one', 'Quote: Start text']],
  ['K7: their edit elsewhere in it, mine inserts: applied', 'the cat sat', 'the big cat sat', [blk('b', 'the cat sat down')], ['b'], ['the big cat sat down']],
  ['K10: their Enter splits it, mine appends: at the end of the second piece', 'Start text', 'Start text!', [blk('b', 'Start '), blk('r', 'text')], ['b'], ['Start ', 'text!']],
  ['K12: their Enter splits repeated letters, mine appends', 'aaa b', 'aaa bc', [blk('b', 'a'), blk('r', 'aa b')], ['b'], ['a', 'aa bc']],
  // Their text only before the block's text, as C0's paste: allowed, so it lands in their new block.
  ['K11: they rewrote it to "Hi" and pasted a NEW "Quote: Start text": mine goes after that text', 'Start text', 'Start text one', [blk('b', 'Hi'), blk('nq', 'Quote: Start text')], ['b'], ['Hi', 'Quote: Start text one']],
  ['their Enter in the second of two equal words, mine deletes one: the deletion that leaves their boundary\'s letters', 'one two two three', 'one two three', [blk('b', 'one t'), blk('r', 'wo two three')], ['b'], ['one t', 'wo three']],
  // Cannot tell: the server's blocks stay byte-equal.
  ['a: they rewrote it to "A dog", mine deletes "cat ": "A dog" stays', 'the cat sat', 'the sat', [blk('b', 'A dog'), blk('d', 'my cat is here')], ['b', 'd'], SERVER],
  ['c: an insertion whose neighbours are gone: the block stays', 'Hello world', 'Hello big world', [blk('b', 'Hello there')], ['b'], SERVER],
  ['K1: their NEW paragraph holds the deleted "cat ": it keeps it', 'the cat sat', 'the sat', [blk('b', 'A dog'), blk('d', 'my cat is here')], ['b'], SERVER],
  ['K2: their NEW paragraph ends in the text mine appends to: it stays', 'Start text', 'Start text!', [blk('b', 'Start'), blk('d', 'Last para with text')], ['b'], SERVER],
  ['C8: they shortened it and pasted a NEW quote of its text: the quote stays', 'Start text', 'Start text one', [blk('b', 'Start'), blk('c', 'Quote: Start text')], ['b'], SERVER],
  ['C11: they rewrote it, mine deletes " world": "wonder world" stays whole', 'Hello world', 'Hello', [blk('b', 'Hi'), blk('c', 'Other'), blk('d', 'wonder world')], undefined, SERVER],
  ['C14: they shortened it, mine adds "!": no block takes it', 'Start text', 'Start text!', [blk('b', 'Start'), blk('c', 'Middle para'), blk('d', 'Last para with text')], undefined, SERVER],
  ['C2: they emptied it: no later paragraph takes mine', 'Start text', 'Start text one two three', [blk('a', 'Above'), blk('b', ''), blk('c', 'Stars at night'), blk('d', 'Extra text here')], undefined, SERVER],
  ['C3: they shortened it to "H": "big" goes nowhere', 'Hello world', 'Hello big world', [blk('b', 'H'), blk('c', 'Other people'), blk('d', 'wonder world')], undefined, SERVER],
  ['C9: a one-letter block replaced: "gamma a" stays', 'a', 'ab', [blk('b', 'x'), blk('c', 'alpha'), blk('d', 'gamma a')], undefined, SERVER],
  ['a block there when the edit was made ends the run: the paste\'s piece after it is not reached', 'Start text', 'Start text one', [blk('b', 'x'), blk('c', 'Below'), blk('nz', 'zStart text')], ['b', 'c'], SERVER],
  ['no keys kept (an older entry): the block alone', 'Start text', 'Start text one', [blk('b', 'x'), blk('ny', 'y'), blk('nz', 'zStart text')], null, SERVER],
  ['C10: mine deletes "two " across their Enter in "tw|o": no placement keeps their boundary', 'one two three', 'one three', [blk('b', 'one tw'), blk('r', 'o three')], ['b'], SERVER],
  ['K3: mine deletes "cat " across their Enter in "c|at"', 'the cat sat', 'the sat', [blk('b', 'the c'), blk('r', 'at sat'), blk('d', 'my cat')], ['b'], SERVER],
  ['K8: both typed at the same spot', 'ab cd', 'ab Y cd', [blk('b', 'ab X cd')], ['b'], SERVER],
  ['K9: their Enter at mine\'s insertion point', 'Start text', 'Start big text', [blk('b', 'Start '), blk('r', 'text')], ['b'], SERVER],
  ['K13: they deleted part of the run mine deletes', 'one two three', 'one three', [blk('b', 'one tw three')], ['b'], SERVER],
  ['K14: their Enter, and their typing in the second piece', 'Start text', 'Start text one', [blk('b', 'Start'), blk('r', 'XX text')], ['b'], SERVER],
  ['K16: they emptied it, mine appends', 'Start text', 'Start text!', [blk('b', '')], ['b'], SERVER],
  ['K11 with the NEW quote holding only part of its text ("Quote: Start")', 'Start text', 'Start text one', [blk('b', 'Hi'), blk('nq', 'Quote: Start')], ['b'], SERVER],
] as [string, string, string, unknown[], string[] | undefined | null, string[] | string][])
  test(`restore of a kept block, ${name}`, () => assert.deepEqual(restored(base, mine, now, keys === null ? undefined : (keys ?? all(now))), want === SERVER ? texts(now) : want))

test('two dead pages combine their block keys: a key either knew is not new', () => {
  const a: Pending = {at: 1, type: 'post', fields: [['body[_key=="b"]', 1]], base: [['body[_key=="b"]', 0]], keys: [['body', ['a', 'b']]], tab: 'a'}
  const b: Pending = {at: 2, type: 'post', fields: [['body[_key=="c"]', 1]], base: [['body[_key=="c"]', 0]], keys: [['body', ['b', 'c']]], tab: 'b'}
  assert.deepEqual(combine([a, b])?.keys, [['body', ['a', 'b', 'c']]])
  assert.equal(combine([{...a, keys: undefined}])?.keys, undefined)
})
