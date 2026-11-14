// J40: an inline comment's span on Portable Text follows its words through edits.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {blockPoint, blockText, mapPtRanges, ptCommentMode, placedPtRanges, type PtRange} from './pt-comment-ranges.ts'

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
