import {test} from 'node:test'
import {simGate} from './table-sim.ts'

// Seeds 8801-8815 x 4,000 scenes (lib/table-sim.ts simGate: what may never happen, and two ceilings).
test('two editors, a column or row changed while both type (seeds 8801-8815): rows even, both agree, every word whole in one cell or on its typer\'s card', () => {
  simGate(Array.from({length: 15}, (_, i) => 8801 + i), {'INSERT-LEFT-WRONG-SIDE': 4, LEFTOVER: 5})
})
