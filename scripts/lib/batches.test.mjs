import assert from 'node:assert/strict'
import {test} from 'node:test'
import {batches, sendBatches} from './batches.mjs'

const del = (i) => ({delete: {id: `d${i}`, type: 'post'}})
test('at most N deletes per request, order kept, other mutations never split it', () => {
  const muts = [{create: {_id: 'a'}}, ...Array.from({length: 120}, (_, i) => del(i)), {publish: {id: 'a'}}]
  const out = batches(muts, 50)
  assert.deepEqual(out.map((b) => b.filter((m) => 'delete' in m).length), [50, 50, 20])
  assert.deepEqual(out.flat(), muts)
  assert.deepEqual(batches([{publish: {id: 'x'}}]), [[{publish: {id: 'x'}}]])
  assert.deepEqual(batches([]), [])
})

test('a batch_too_large naming a lower cap sends that part again at it', async () => {
  const sizes = []
  const send = async (part) => {
    sizes.push(part.length)
    return part.length > 40 ? new Response(JSON.stringify({error: {code: 'batch_too_large', details: {kind: 'delete', max: 40, count: part.length}}}), {status: 422}) : new Response('{}')
  }
  const res = await sendBatches(Array.from({length: 100}, (_, i) => del(i)), send)
  assert.equal(res.ok, true)
  assert.deepEqual(sizes, [100, 40, 40, 20])
})
