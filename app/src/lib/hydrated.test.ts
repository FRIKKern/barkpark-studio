import {test} from 'node:test'
import assert from 'node:assert/strict'
import {onlyMatch} from './hydrated.ts'

// An early change to a control with no id is put in again only on the one live control with
// its label: none or several (the page drawn differently than the server's) and it is
// dropped, never guessed onto the wrong control.
test('early changes: a label fallback replays only on a unique match', () => {
  const label = (c: {label: string}) => c.label
  const sort = {label: 'Sort'}
  assert.equal(onlyMatch([{label: 'Visibility'}, sort], 'Sort', label), sort)
  assert.equal(onlyMatch([{label: 'Sort'}, {label: 'Sort'}], 'Sort', label), null)
  assert.equal(onlyMatch([{label: 'Visibility'}], 'Sort', label), null)
  assert.equal(onlyMatch([], 'Sort', label), null)
})
