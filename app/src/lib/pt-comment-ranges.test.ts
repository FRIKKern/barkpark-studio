// J40: an inline comment's span on Portable Text follows its words through edits.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {commentRangesOf, type Thread} from './comment-threads.ts'
import {blockPoint, blockText, findPtRange, mapPtRanges, ptCommentMode, ptRangeText, ptSpanSaves, placedPtRanges, type PtRange} from './pt-comment-ranges.ts'

const block = (_key: string, ...texts: string[]) => ({_key, _type: 'block', children: texts.map((text, i) => ({_key: `${_key}s${i}`, _type: 'span', text}))})
const at = (blockId: string, from: number, to: number, endBlock = blockId): PtRange => ({id: 't1', anchor: {blockId, offset: from}, head: {blockId: endBlock, offset: to}})
/** The words the span is on after the edit, a line per block; null when it is gone. */
const words = (before: unknown[], after: unknown[], range: PtRange, caret?: {blockId: string; offset: number}) => {
  const [r] = placedPtRanges(after, mapPtRanges(before, after, [range], caret))
  if (!r) return null
  const blocks = after as {_key: string}[]
  const [a, h] = [blocks.findIndex((b) => b._key === r.anchor.blockId), blocks.findIndex((b) => b._key === r.head.blockId)]
  return blocks.slice(a, h + 1).map((b, i, all) => blockText(b).slice(i ? 0 : r.anchor.offset, i === all.length - 1 ? r.head.offset : undefined)).join('\n')
}

const BEFORE = [block('p1', 'Alpha beta ', 'gamma delta.'), block('p2', 'Second line.')]
const GAMMA = at('p1', 11, 16)

test('a span follows its words: typing before it, at its edges and inside it', () => {
  assert.equal(blockText(BEFORE[0]), 'Alpha beta gamma delta.')
  assert.equal(words(BEFORE, [block('p1', 'Zero Alpha beta ', 'gamma delta.'), BEFORE[1]], GAMMA), 'gamma')
  assert.equal(words(BEFORE, [block('p1', 'Alpha beta ', 'gaXXmma delta.'), BEFORE[1]], GAMMA), 'gaXXmma')
  // Typed at either edge: outside it.
  assert.equal(words(BEFORE, [block('p1', 'Alpha beta ', 'gamma! delta.'), BEFORE[1]], GAMMA), 'gamma')
  assert.equal(words(BEFORE, [block('p1', 'Alpha beta !', 'gamma delta.'), BEFORE[1]], GAMMA), 'gamma')
  // "g" typed right before "gamma": the caret says where it went in (the texts alone read as "ggamma").
  assert.equal(words(BEFORE, [block('p1', 'Alpha beta g', 'gamma delta.'), BEFORE[1]], GAMMA, {blockId: 'p1', offset: 12}), 'gamma')
  // A mark put on part of it splits its span in three: the text is the same, so is the span.
  assert.equal(words(BEFORE, [block('p1', 'Alpha beta ', 'ga', 'mm', 'a delta.'), BEFORE[1]], GAMMA), 'gamma')
})

test('a span shrinks with its words and goes when they are all deleted', () => {
  assert.equal(words(BEFORE, [block('p1', 'Alpha beta ', 'gaa delta.'), BEFORE[1]], GAMMA), 'gaa')
  assert.equal(words(BEFORE, [block('p1', 'Alpha bemma delta.'), BEFORE[1]], GAMMA), 'mma')
  assert.equal(words(BEFORE, [block('p1', 'Alpha beta ', ' delta.'), BEFORE[1]], GAMMA), null)
  assert.equal(words(BEFORE, [block('p1', 'Alpha.'), BEFORE[1]], GAMMA), null)
  // Its block deleted: gone, and so for the block after one that stays.
  assert.equal(words(BEFORE, [BEFORE[1]], GAMMA), null)
  assert.equal(words(BEFORE, [BEFORE[0]], at('p2', 0, 6)), null)
  assert.equal(words(BEFORE, [], GAMMA), null)
})

test('a span follows its words through a block split and a join', () => {
  // Enter before it: its words are in the new block.
  const split = [block('p1', 'Alpha '), block('n1', 'beta ', 'gamma delta.'), BEFORE[1]]
  assert.deepEqual(mapPtRanges(BEFORE, split, [GAMMA]), [at('n1', 5, 10)])
  // Enter inside it: it runs over both blocks.
  assert.equal(words(BEFORE, [block('p1', 'Alpha beta ', 'gam'), block('n1', 'ma delta.'), BEFORE[1]], GAMMA), 'gam\nma')
  // Enter after it: where it was.
  assert.deepEqual(mapPtRanges(BEFORE, [block('p1', 'Alpha beta ', 'gamma'), block('n1', ' delta.'), BEFORE[1]], [GAMMA]), [GAMMA])
  // Backspace at the start of the second block joins it into the first.
  assert.deepEqual(mapPtRanges(split, BEFORE, [at('n1', 5, 10)]), [GAMMA])
  assert.deepEqual(mapPtRanges(BEFORE, [block('p1', 'Alpha beta ', 'gamma delta.', 'Second line.')], [at('p2', 0, 6)]), [at('p1', 23, 29)])
  // Another block put in, and the blocks moved: by key, where it was.
  assert.deepEqual(mapPtRanges(BEFORE, [block('x', 'New'), BEFORE[1], BEFORE[0]], [GAMMA]), [GAMMA])
})

test("another editor's save with two edits in the block keeps the span between them", () => {
  assert.equal(words(BEFORE, [block('p1', 'Alfa beta ', 'gamma delta!'), BEFORE[1]], GAMMA), 'gamma')
  // A split and typing that came in one save.
  assert.equal(words(BEFORE, [block('p1', 'Alpha beta now'), block('n1', 'gamma delta.'), BEFORE[1]], GAMMA), 'gamma')
})

test('a span the value does not hold is left as it is, and not placed', () => {
  const stray = at('zz', 1, 4)
  assert.deepEqual(mapPtRanges(BEFORE, BEFORE, [stray, GAMMA]), [stray, GAMMA])
  assert.deepEqual(placedPtRanges(BEFORE, [stray, at('p1', 30, 40), {id: 'back', anchor: {blockId: 'p1', offset: 16}, head: {blockId: 'p1', offset: 11}}]), [{...at('p1', 11, 16), id: 'back'}])
  assert.deepEqual(blockPoint(BEFORE, {blockId: 'p1', path: 'p1s1', offset: 3}), {blockId: 'p1', offset: 14})
  // An offset that is no number: left as it is, never placed.
  const broken = at('p1', NaN, 16)
  assert.deepEqual(mapPtRanges(BEFORE, [block('p1', 'Zero Alpha beta gamma delta.')], [broken]), [broken])
  assert.deepEqual(placedPtRanges(BEFORE, [broken]), [])
})

test('spans are followed and saved only in an editor of the draft', () => {
  assert.equal(ptCommentMode({editable: true}), 'edit')
  // A read seat, a locked draft: the saved spans, painted as they are.
  assert.equal(ptCommentMode({editable: false}), 'read')
  // The published version or a revision, editable or not: their text is not what the spans are on.
  assert.equal(ptCommentMode({otherVersion: true, editable: false}), 'none')
  assert.equal(ptCommentMode({otherVersion: true, editable: true}), 'none')
})

test('a span read afresh is on its quote: where it was saved, found again in its block, or unlinked', () => {
  assert.equal(ptRangeText(BEFORE, GAMMA), 'gamma')
  assert.equal(ptRangeText(BEFORE, at('p1', 17, 6, 'p2')), 'delta.\nSecond')
  assert.deepEqual(findPtRange(BEFORE, GAMMA, 'gamma'), GAMMA)
  // An API patch put "Zero " before it: the saved offsets are on "beta ", the quote is 5 further on.
  const patched = [block('p1', 'Zero Alpha beta gamma delta.'), BEFORE[1]]
  assert.equal(ptRangeText(patched, GAMMA), 'beta ')
  assert.deepEqual(findPtRange(patched, GAMMA, 'gamma'), at('p1', 16, 21))
  // Twice in the block: the one nearest to where it was saved.
  assert.deepEqual(findPtRange([block('p1', 'gamma Alpha beta de gamma.')], GAMMA, 'gamma'), at('p1', 20, 25))
  assert.deepEqual(findPtRange([block('p1', 'gamma Alpha beta delta and gamma.')], GAMMA, 'gamma'), at('p1', 0, 5))
  assert.deepEqual(findPtRange([block('p1', 'gamma Alph gamma.')], GAMMA, 'gamma'), at('p1', 11, 16))
  // Discard changes took the word away (the offsets are on "delta"), or its block: unlinked, never on other words.
  assert.equal(findPtRange([block('p1', 'Alpha beta delta.'), BEFORE[1]], GAMMA, 'gamma'), null)
  assert.equal(findPtRange([BEFORE[1]], GAMMA, 'gamma'), null)
  // Not looked for in another block.
  assert.equal(findPtRange([block('p1', 'Alpha.'), block('p2', 'gamma')], GAMMA, 'gamma'), null)
  // Over two blocks: where it was saved or unlinked; a browser's own line breaks in the quote are no difference.
  const two = at('p1', 17, 6, 'p2')
  assert.deepEqual(findPtRange(BEFORE, two, 'delta.\n\nSecond'), two)
  assert.equal(findPtRange(patched, two, 'delta.\nSecond'), null)
})

test('only spans linked to their words are saved, with their text; one as saved again drops its waiting save', () => {
  const stored = [{...GAMMA, text: 'gamma'}, {...at('p2', 0, 6), id: 't2', text: 'Second'}, {...at('p2', 7, 11), id: 't3', text: 'gone'}, {...at('p2', 12, 16), id: 't4', text: 'here'}]
  // A receiving browser read "Zero " typed by another before that editor's span save came: the
  // stale span is found again on its quote, so what this browser saves after its own typing is right.
  const value = [block('p1', 'Zero Alpha beta gamma delta.'), block('p2', 'Second line here.')]
  const found = findPtRange(value, GAMMA, 'gamma')!
  const live = new Map([['t1', {anchor: found.anchor, head: found.head}], ['t2', {anchor: {blockId: 'p2', offset: 0}, head: {blockId: 'p2', offset: 6}}]])
  assert.deepEqual(ptSpanSaves(stored, value, live, new Set(['t4'])), {
    moves: [{id: 't1', selection: {anchor: {blockId: 'p1', offset: 16}, head: {blockId: 'p1', offset: 21}}, text: 'gamma'}, {id: 't4', selection: null}],
    same: ['t2'], // t3 was never linked: nothing is saved for it
  })
  // Typed inside it: where it is saved is the same at its start, its text is not.
  const inside = [block('p1', 'Alpha beta gaXmma delta.'), BEFORE[1]]
  assert.deepEqual(ptSpanSaves([stored[0]!], inside, new Map([['t1', at('p1', 11, 17)]]), new Set()).moves, [{id: 't1', selection: {anchor: {blockId: 'p1', offset: 11}, head: {blockId: 'p1', offset: 17}}, text: 'gaXmma'}])
  assert.deepEqual(findPtRange(inside, at('p1', 11, 17), 'gaXmma'), at('p1', 11, 17))
})

test("a thread's span is the thread's, whatever its saved selection carries", () => {
  // A comment sent while its composer's span was followed through an edit was saved with the draft's id in its selection.
  const root = {_id: 't9', documentId: 'd', documentType: 'post', fieldPath: 'ptBody', threadId: 't9', message: 'm', authorEmail: null, createdAt: '', selection: {id: '__draft', anchor: GAMMA.anchor, head: GAMMA.head}}
  assert.deepEqual(commentRangesOf([{root, replies: [], status: 'open'} as Thread], 'ptBody', undefined, new Map()), [{id: 't9', anchor: GAMMA.anchor, head: GAMMA.head}])
})
