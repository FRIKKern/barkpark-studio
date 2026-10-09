import assert from 'node:assert/strict'
import {test} from 'node:test'
import {batches} from './batches.mjs'

const del = (i) => ({delete: {id: `d${i}`, type: 'post'}})
test('at most 50 deletes per request, order kept, other mutations never split it', () => {
  const muts = [{create: {_id: 'a'}}, ...Array.from({length: 120}, (_, i) => del(i)), {publish: {id: 'a'}}]
  const out = batches(muts)
  assert.deepEqual(out.map((b) => b.filter((m) => 'delete' in m).length), [50, 50, 20])
  assert.deepEqual(out.flat(), muts)
  assert.deepEqual(batches([{publish: {id: 'x'}}]), [[{publish: {id: 'x'}}]])
  assert.deepEqual(batches([]), [])
})
