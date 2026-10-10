import assert from 'node:assert/strict'
import {test} from 'node:test'
import {seedPlan} from './seed-plan.mjs'

test('seed plan: --schemas writes schemas only, no files; --verify only reads', () => {
  assert.deepEqual(seedPlan(['--schemas'], 'e2e-me'), {schemas: true, reset: false, verify: false, assets: 'none'})
  assert.deepEqual(seedPlan(['--verify'], 'e2e-me'), {schemas: false, reset: false, verify: true, assets: 'find'})
  assert.deepEqual(seedPlan(['--verify'], 'production'), {schemas: false, reset: false, verify: true, assets: 'find'})
})

test('seed plan: a reset uploads what it lacks; --data keeps the schemas; production is refused unless named', () => {
  assert.deepEqual(seedPlan([], 'e2e-me'), {schemas: true, reset: true, verify: true, assets: 'upload'})
  assert.equal(seedPlan(['--data'], 'e2e-me').schemas, false)
  assert.match(seedPlan(['--schemas'], 'production').refuse ?? '', /--production/)
  assert.equal(seedPlan(['--schemas', '--production'], 'production').refuse, undefined)
})
