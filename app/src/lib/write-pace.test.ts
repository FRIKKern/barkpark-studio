import {test} from 'node:test'
import assert from 'node:assert/strict'
import {paceMs, paced} from './write-pace.ts'

test('a throttled write doubles the gap up to 4 s; clean writes take it back to none', () => {
  assert.equal(paceMs(), 0)
  paced(true)
  assert.equal(paceMs(), 500)
  for (let i = 0; i < 6; i++) paced(true)
  assert.equal(paceMs(), 4000)
  for (let i = 0; i < 30; i++) paced(false)
  assert.equal(paceMs(), 0)
})
