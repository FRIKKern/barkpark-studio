// B11 widen: kept form edits are replayed, asked about, or dropped against the doc as it is now.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Doc} from './data.ts'
import {judge, restoreValue, type Pending} from './pending-edits.ts'

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
