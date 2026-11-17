import {test} from 'node:test'
import assert from 'node:assert/strict'
import {leftover, simGate} from './table-sim.ts'

// Review 7's seeds (lib/table-sim.ts simGate): 63018 (#136, a key from the old grid into the other
// editor's saved cell: LOST and DOUBLED on a7fc7a1c) and 96019 (#208, the other editor's first key
// left before my word); SEEDS_CARET: seeds that break without caretColumn's alike-either-way rule.
const SEEDS_CARET: number[] = []

test('two editors, a column or row changed while both type (review 7 seeds): rows even, both agree, every word whole in one cell or on its typer\'s card', () => {
  simGate([63018, 96019, ...SEEDS_CARET], {'INSERT-LEFT-WRONG-SIDE': 9, LEFTOVER: 9})
})

test('a word\'s first keys left before another word, the whole word on its typer\'s card, read as LEFTOVER, not SPLIT', () => {
  // Seed 96019 #208: P's '<' saved, T typed '<U8>' after it as T saw it; P's '<Q8>' is whole on P's card.
  assert.equal(leftover('<<U8>', '<', ['<Q8>']), true)
  // The cell is only the first keys (a column no one could tell): as before.
  assert.equal(leftover('x<', 'x<', ['x<T6>']), true)
  // Keys no kept text begins with, or keys after a word: SPLIT.
  assert.equal(leftover('<<U8>', '<', ['x<Q8>']), false)
  assert.equal(leftover('<U8>Q8>', 'Q8>', ['<Q8>']), false)
})
