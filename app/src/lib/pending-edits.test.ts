// B11 widen: kept form edits are replayed, asked about, or dropped against the doc as it is now.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Doc, Schema} from './data.ts'
import {combine, judge, restoreValue, type Pending} from './pending-edits.ts'

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
