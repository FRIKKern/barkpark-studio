import {test} from 'node:test'
import {simGate} from './table-sim.ts'

// Seeds 7701-7710 x 4,000 scenes (lib/table-sim.ts simGate: what may never happen, and two ceilings).
test('two editors, a column or row changed while both type (seeds 7701-7710): rows even, both agree, every word whole in one cell or on its typer\'s card', () => {
  simGate(Array.from({length: 10}, (_, i) => 7701 + i), {'INSERT-LEFT-WRONG-SIDE': 3, LEFTOVER: 4})
})
