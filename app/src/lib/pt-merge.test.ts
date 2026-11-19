// Two editors change one Portable Text block at once (a paste, a split): both texts kept,
// each once (task-7777e1ba8c35d896). node --test.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mergeList3, onto} from './merge.ts'
import {freshItems, remoteBlockPatches} from './pt-value.ts'
import {keysFrom, mergeBlock, withTheirWords} from './pt-merge.ts'
import {rebase, type Spots} from './edit-bases.ts'

let n = 0
keysFrom(() => `k${++n}`)
const blk = (key: string, ...spans: [key: string, text: string, marks?: string[]][]) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: spans.map(([k, text, marks = []]) => ({_type: 'span', _key: k, text, marks}))})
const texts = (v: unknown) => (v as {children: {text?: string}[]}[]).map((b) => b.children.map((c) => c.text ?? '').join(''))
// Each word once: none lost, none doubled.
const once = (v: unknown, words: string[]) => {
  const all = texts(v).join('|')
  for (const w of words) assert.equal(all.split(w).length - 1, 1, `"${w}" in ${JSON.stringify(texts(v))}`)
}
const base = [blk('b1', ['b1s', 'Start text'])]
// The scene's two pastes, as the browsers sent them (build-paste2/repro.log): B1 pastes at the
// end of the block, B2 at its start (its paste gives the block a new span key).
const b1Line = [blk('b1', ['b1s', 'Start text one two three'])]
const b2Line = [blk('b1', ['af06', 'x y z Start text'])]
const b1Multi = [blk('b1', ['b1s', 'Start text one']), blk('t2', ['t2s', 'two']), blk('t3', ['t3s', 'three'])]
const b2Multi = [blk('b1', ['x1', 'x']), blk('y2', ['x1', 'y']), blk('z3', ['z3s', 'z Start text'])]

test('a one-line paste each: both kept, whoever saves second', () => {
  assert.deepEqual(texts(mergeList3(base, b2Line, b1Line)), ['x y z Start text one two three'])
  assert.deepEqual(texts(mergeList3(base, b1Line, b2Line)), ['x y z Start text one two three'])
})

test('pastes that split the block: their words go where the block text went, their blocks once', () => {
  const want = ['x', 'y', 'z Start text one', 'two', 'three']
  assert.deepEqual(texts(mergeList3(base, b2Multi, b1Multi)), want)
  // B1 refused and merged: main kept its b1 whole and added B2's blocks, "Start text" twice and "x" gone.
  const b1Second = mergeList3(base, b1Multi, b2Multi)
  once(b1Second, ['Start text', 'one', 'two', 'three'])
  assert.deepEqual(texts(b1Second), want)
})

test('the save measured from a frame that came first (freshItems) keeps theirs', () => {
  assert.deepEqual(texts(freshItems(base, b2Line, b1Line)), ['x y z Start text one two three'])
  // Their blocks already drawn after its own (remoteBlockPatches puts them there): none twice.
  const drawn = [...b2Multi, b1Multi[1], b1Multi[2]]
  assert.deepEqual(texts(freshItems(base, drawn, b1Multi)), ['x', 'y', 'z Start text one', 'two', 'three'])
  // Not drawn: their blocks come after the blocks this paste made.
  assert.deepEqual(texts(freshItems(base, b2Multi, b1Multi)), ['x', 'y', 'z Start text one', 'two', 'three'])
})

test('their words this editor has drawn already are not added again', () => {
  // It drew "one two three" (diff-match-patch into b1s), then pasted at the start.
  const mine = [blk('b1', ['af06', 'x y z Start text one two three'])]
  assert.deepEqual(texts(freshItems(b1Line, mine, b1Line)), ['x y z Start text one two three'])
  assert.deepEqual(texts(mergeList3(base, mine, b1Line)), ['x y z Start text one two three'])
})

test('a block saved by its key (a longer body) merges as text too', () => {
  const merged = mergeBlock(base[0], b2Line[0], b1Line[0])
  assert.deepEqual(texts([merged]), ['x y z Start text one two three'])
  assert.deepEqual(texts([onto(base[0], b2Line[0], b1Line[0])]), ['x y z Start text one two three'])
  const e: Spots = {dirty: new Map([['ptBody[_key=="b1"]', b2Line[0]]]), inflight: null, base: new Map([['ptBody[_key=="b1"]', base[0]]])}
  rebase(e, {_id: 'd', _type: 'post', _rev: 'r2', ptBody: b1Line} as never)
  assert.deepEqual(texts([e.dirty.get('ptBody[_key=="b1"]')]), ['x y z Start text one two three'])
})

test('marks, an inline object and the other blocks stay as they were', () => {
  const was = [blk('a', ['as', 'Alpha']), {...blk('b1', ['s1', 'Start '], ['s2', 'bold', ['strong']]), children: [{_type: 'span', _key: 's1', text: 'Start ', marks: []}, {_type: 'span', _key: 's2', text: 'bold', marks: ['strong']}, {_type: 'mention', _key: 'm1'}, {_type: 'span', _key: 's3', text: ' end', marks: []}]}]
  const mine = [was[0], {...was[1], children: [{_type: 'span', _key: 'n1', text: 'Mine ', marks: []}, ...(was[1] as {children: unknown[]}).children]}]
  const theirs = [was[0], {...was[1], children: (was[1] as {children: {text?: string}[]}).children.map((c) => (c.text === ' end' ? {...c, text: ' end theirs'} : c))}]
  const out = mergeList3(was, mine, theirs) as {children: {_key: string; text?: string; marks?: string[]}[]}[]
  assert.deepEqual(texts(out), ['Alpha', 'Mine Start bold end theirs'])
  assert.deepEqual(out[1]!.children.map((c) => c._key), ['n1', 's1', 's2', 'm1', 's3'])
  assert.deepEqual(out[1]!.children[2]!.marks, ['strong'])
})

test('where no text merge can be made, their words go at the end of that block, the same from either side, once', () => {
  const doc = [blk('a', ['as', 'Alpha']), blk('b1', ['b1s', 'Start text']), blk('c', ['cs', 'Gamma'])]
  const rewrote = [doc[0], blk('b1', ['s', 'Completely new']), doc[2]]
  const added = [doc[0], blk('b1', ['b1s', 'Start text and more']), doc[2]]
  const want = ['Alpha', 'Completely new and more', 'Gamma']
  const second = mergeList3(doc, rewrote, added)!
  assert.deepEqual(texts(second), want) // in the block they typed in, not at the end of the body
  assert.deepEqual(texts(mergeList3(doc, added, rewrote)), want)
  // It settles: their words come back in the next frame and are not added again.
  assert.deepEqual(texts(mergeList3(doc, second, added)), want)
  assert.deepEqual(texts(freshItems(doc, second, added)), want)
})

test('a frame R moves the fence and the base together: every pending spot holds R\'s words', () => {
  const R = {_id: 'd', _type: 'post', _rev: 'R', ptBody: b1Line} as never
  // The whole field (a paste that added blocks) and a block saved by its key (a longer body).
  const whole: Spots = {dirty: new Map([['ptBody', b2Multi]]), inflight: null, base: new Map([['ptBody', base]]), rev: 'r1'}
  rebase(whole, {_id: 'd', _type: 'post', _rev: 'R', ptBody: b1Multi} as never)
  assert.equal(whole.rev, 'R')
  assert.deepEqual(whole.base.get('ptBody'), b1Multi)
  assert.deepEqual(texts(whole.dirty.get('ptBody')), ['x', 'y', 'z Start text one', 'two', 'three'])
  const keyed: Spots = {dirty: new Map([['ptBody[_key=="b1"]', b2Line[0]]]), inflight: null, base: new Map([['ptBody[_key=="b1"]', base[0]]]), rev: 'r1'}
  rebase(keyed, R)
  assert.equal(keyed.rev, 'R')
  assert.deepEqual(texts([keyed.dirty.get('ptBody[_key=="b1"]')]), ['x y z Start text one two three'])
})

test('their block edited by text only still comes in as diff-match-patch after own paste returns merged', () => {
  // This editor pasted at the start (its span af06); the answer to its save holds theirs too.
  const seen = new Map([['b1/af06', 'x y z Start text']])
  const got = remoteBlockPatches(b1Line, [blk('b1', ['af06', 'x y z Start text one two three'])], b2Line, [], new Set(), seen)
  assert.equal(got.length, 1)
  assert.equal(got[0]!.type, 'diffMatchPatch')
  // An older answer without letters typed since takes none out.
  assert.deepEqual(remoteBlockPatches(b1Line, [blk('b1', ['af06', 'x y z Start'])], b2Line, [], new Set(), new Map([['b1/af06', 'x y z Start text']])), [])
})

test('withTheirWords leaves a list alone when no block was changed by both', () => {
  const mine = [blk('b1', ['b1s', 'Start text']), blk('n', ['ns', 'new'])]
  assert.deepEqual(withTheirWords(base, mine, b1Line).mine, mine)
})
