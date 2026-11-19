// The hold in PortableTextInput (lib/pt-hold.ts): which of this editor's changes hold another
// editor's frames until the change is emitted (node --test).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {MINE_WAIT_MS, startsHold, waitsForMine} from './pt-hold.ts'
import {remoteBlockPatches, withRemote} from './pt-value.ts'

const texts = (v: unknown) => (v as {children: {text: string}[]}[]).map((b) => b.children.map((c) => c.text).join(''))

const span = ['b1', 'children', {_key: 's1'}, 'text']

test('typing in a span does not hold their frames; a paste, a split or a join does', () => {
  // Held while a word is typed, their frames came as one with this editor's echoed words in it: twice on screen.
  assert.equal(startsHold({type: 'diffMatchPatch', path: span, value: '@@ -1,4 +1,5 @@\n Pour\n+s\n'} as never), false, 'typing')
  // A paste or a split: blocks inserted, a block set with fewer letters; a join: one unset.
  assert.equal(startsHold({type: 'insert', path: [{_key: 'b1'}], position: 'after', items: [{_key: 'r'}]} as never), true, 'paste or split')
  assert.equal(startsHold({type: 'set', path: [{_key: 'b1'}], value: {_key: 'b1'}} as never), true, 'a block set')
  assert.equal(startsHold({type: 'unset', path: [{_key: 'r'}]} as never), true, 'join')
})

test('their frames wait for a held change until it is emitted, at most MINE_WAIT_MS', () => {
  assert.equal(waitsForMine(0, 10_000), false, 'nothing held')
  assert.equal(waitsForMine(10_000, 10_000 + MINE_WAIT_MS - 1), true)
  assert.equal(waitsForMine(10_000, 10_000 + MINE_WAIT_MS), false, 'waited long enough')
})

test("with no hold on, their frame that echoes this editor's own words puts those words on the screen once", () => {
  const blk = (text: string) => ({_key: 'b1', _type: 'block', style: 'normal', markDefs: [], children: [{_key: 'b1s', _type: 'span', marks: [], text}]})
  // This editor typed " from" (emitted and saved) and " a" (on screen, not emitted yet); their
  // frame has their " gently" and its own " from", echoed.
  const seen = new Map([['b1/b1s', 'Pour slowly from']])
  const shown = [blk('Pour slowly from a')]
  const got = remoteBlockPatches([blk('Pour slowly')], [blk('Pour gently slowly from')], shown, [], new Set(), seen)
  assert.deepEqual(texts(withRemote(shown, got, true)), ["Pour gently slowly from a"])
})
