// Two editors change one Portable Text block at once (a paste, a split): both texts kept,
// each once (task-7777e1ba8c35d896). node --test.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mergeList3, onto} from './merge.ts'
import {freshItems, remoteBlockPatches} from './pt-value.ts'
import {keysFrom, withTheirWords} from './pt-merge.ts'
import {caught, keepWords, mergeBlock, mergeBlocks} from './pt-keep.ts'
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
  // It settles: the other editor takes the merged frame as it is, and a merge after that is made
  // from it (a frame moves the base: edit-bases rebase, the save measured from what was drawn).
  assert.deepEqual(texts(mergeList3(added, added, second)), want)
  assert.deepEqual(texts(freshItems(second, second, second)), want)
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

test('a new block after an unchanged one, their words in that one: both, in their blocks', () => {
  const mine = [blk('b1', ['b1s', 'Start text']), blk('n', ['ns', 'new'])]
  assert.deepEqual(texts(mergeList3(base, mine, b1Line)), ['Start text one two three', 'new'])
  assert.deepEqual(texts(mergeList3(base, b1Line, mine)), ['Start text one two three', 'new'])
  assert.deepEqual(withTheirWords(base, [base[0]], b1Line).mine, [base[0]]) // nothing of mine changed: left alone
})

test('a block saved by its key that they split meanwhile: the field goes whole, their split and my words kept', () => {
  const doc = [blk('a', ['as', 'Above']), blk('b1', ['b1s', 'Start text']), blk('c', ['cs', 'Below'])]
  // This editor pasted at the block's end (saved by key); the other split it with a paste at its start.
  const mine = blk('b1', ['b1s', 'Start text one two three'])
  const theirs = [doc[0], blk('b1', ['x1', 'x']), blk('y2', ['x1', 'y']), blk('z3', ['z3s', 'z Start text']), doc[2]]
  const e: Spots = {dirty: new Map([['ptBody[_key=="b1"]', mine]]), inflight: null, base: new Map([['ptBody[_key=="b1"]', doc[1]]]), rev: 'r1'}
  rebase(e, {_id: 'd', _type: 'post', _rev: 'R', ptBody: theirs} as never, {_id: 'd', _type: 'post', _rev: 'r1', ptBody: [doc[0], mine, doc[2]]} as never)
  assert.equal(e.rev, 'R')
  assert.deepEqual([...e.dirty.keys()], ['ptBody'])
  assert.deepEqual(texts(e.dirty.get('ptBody')), ['Above', 'x', 'y', 'z Start text one two three', 'Below'])
})

test('their new block before the block (a paste that split it at its start): its text once, before mine', () => {
  const theirs = [blk('n1', ['n1s', 'Header']), blk('b1', ['b1s', 'Start text'])]
  const mine = [blk('b1', ['b1s', 'Start text one'])]
  // Their run reads "Header¶Start text": the new block's text goes in front, as a block of its own.
  const split = mergeList3(base, mine, [blk('n1', ['n1s', 'Header']), blk('b1', ['b1s', 'X Start text'])]) as {_key: string}[]
  assert.deepEqual(texts(split), ['Header', 'X Start text one'])
  assert.deepEqual(split.map((b) => b._key), ['n1', 'b1'])
  assert.deepEqual(texts(mergeList3(base, mine, theirs)), ['Header', 'Start text one'])
  assert.deepEqual(texts(freshItems(base, mine, theirs)), ['Header', 'Start text one'])
})

test('a block written back unchanged with its keys in another order is not an edit: their version of it stays', () => {
  const was = [blk('b1', ['b1s', 'Start text one']), blk('t', ['ts', 'three'])]
  const reordered = (b: Record<string, unknown>) => Object.fromEntries(Object.entries(b).reverse())
  const mine = [reordered(was[0]!), blk('t', ['ts', 'three four'])]
  const theirs = [blk('b1', ['x1', 'x']), blk('z3', ['z3s', 'z Start text one']), was[1]]
  assert.deepEqual(texts(mergeList3(was, mine, theirs)), ['x', 'z Start text one', 'three four'])
})

test('their words are kept when the same words are elsewhere in mine (a rewrite), either order, once more', () => {
  const rewrite = 'Totally different words, as a rewrite'
  for (const [was, X] of [['Start text here', ' as'], ['Start text here', ' words'], ['Start text here', ' a'], ['Start text here', ' new'], ['Start text here fox', 'e']] as const) {
    const doc = [blk('b1', ['b1s', was])]
    const mine = [blk('b1', ['n', rewrite])]
    const theirs = [blk('b1', ['b1s', was + X])]
    const one = texts(mergeList3(doc, mine, theirs))
    assert.deepEqual(texts(mergeList3(doc, theirs, mine)), one)
    assert.equal(one[0]!.split(X).length - 1, rewrite.split(X).length, `${X} in ${one[0]}`)
  }
})

test('a paste over a selection next to the other paste: both pastes kept, either order', () => {
  const doc = [blk('b1', ['s', 'abcdefghij'])]
  for (const [a, b, want] of [['abcdefghijABC', 'abcdefgh123', 'abcdefgh123ABC'], ['ABCbcdefghij', '123bcdefghij', '123ABCbcdefghij'], ['abcdefABCghij', 'abc123ghij', 'abc123ABCghij']]) {
    assert.deepEqual(texts(mergeList3(doc, [blk('b1', ['s', a!])], [blk('b1', ['s', b!])])), [want])
    assert.deepEqual(texts(mergeList3(doc, [blk('b1', ['s', b!])], [blk('b1', ['s', a!])])), [want])
  }
})

test('the same text at the same place by both is stored once; at two places, twice', () => {
  const doc = [blk('b1', ['s', 'Start text'])]
  const at = (i: number) => [blk('b1', ['s', `Start text`.slice(0, i) + 'abc' + 'Start text'.slice(i)])]
  assert.deepEqual(texts(mergeList3(doc, at(5), at(5))), ['Startabc text'])
  assert.deepEqual(texts(freshItems(doc, at(10), at(10))), ['Start textabc'])
  assert.deepEqual(texts(mergeList3(doc, at(0), at(10))), ['abcStart textabc'])
  assert.deepEqual(texts(mergeList3(doc, at(10), at(0))), ['abcStart textabc'])
})

test('a paste that splits a block the other joined to the one before: every word once, either order', () => {
  const doc = [blk('a', ['as', 'Above']), blk('b1', ['b1s', 'Start text']), blk('c', ['cs', 'Below'])]
  const joined = [blk('a', ['as', 'AboveStart text']), doc[2]]
  const split = [doc[0], blk('b1', ['b1s', 'Stax']), blk('y', ['ys', 'y']), blk('z', ['zs', 'zrt text']), doc[2]]
  const want = ['AboveStax', 'y', 'zrt text', 'Below']
  assert.deepEqual(texts(mergeList3(doc, joined, split)), want)
  assert.deepEqual(texts(mergeList3(doc, split, joined)), want)
  assert.deepEqual(texts(freshItems(doc, joined, split)), want)
  assert.deepEqual(texts(freshItems(doc, split, joined)), want)
})

test('the net: words a list merge dropped go at the end of their block run, once; a sound merge is left as it is', () => {
  const doc = [blk('a', ['as', 'Alpha']), blk('b1', ['b1s', 'Start text']), blk('c', ['cs', 'Gamma'])]
  const mine = [doc[0], blk('b1', ['b1s', 'Start text']), blk('n', ['ns', 'new words']), doc[2]]
  const theirs = [doc[0], blk('b1', ['b1s', 'Start text and more']), doc[2]]
  const was = caught.count
  // A path that loses mine's new block and their words both.
  const out = mergeBlocks(doc, mine, theirs, () => doc)!
  assert.deepEqual(texts(out), ['Alpha', 'Start text and more new words', 'Gamma'])
  assert.equal(caught.count, was + 1)
  assert.deepEqual(keepWords(doc, mine, theirs, out), out)
  assert.deepEqual(keepWords(doc, mine, theirs, mergeList3(doc, mine, theirs)!), mergeList3(doc, mine, theirs))
  assert.equal(caught.count, was + 1)
})
