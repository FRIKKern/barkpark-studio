import {test} from 'node:test'
import {simGate} from './table-sim.ts'

// Seeds 8816-8830 x 4,000 scenes (lib/table-sim.ts simGate: what may never happen, and two ceilings).
test('two editors, a column or row changed while both type (seeds 8816-8830): rows even, both agree, every word whole in one cell or on its typer\'s card, every key in a cell, on the card or in the input', () => {
  simGate(Array.from({length: 15}, (_, i) => 8816 + i), {'INSERT-LEFT-WRONG-SIDE': 4, LEFTOVER: 3})
})
