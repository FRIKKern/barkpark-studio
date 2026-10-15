import assert from 'node:assert/strict'
import {test} from 'node:test'
import {laneResetRefusal, seedPlan} from './seed-plan.mjs'

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

test('lane reset (run.mjs reset): e2e lane datasets only; production, shared ones and --production refused', () => {
  assert.equal(laneResetRefusal('e2e-freeform'), undefined)
  for (const dataset of ['production', 'ci', 'staging', 'e2e-', 'xe2e-me', 'e2e-ME', undefined]) assert.match(laneResetRefusal(dataset) ?? '', /e2e lane dataset/, String(dataset))
  assert.match(laneResetRefusal('e2e-me', ['--production']) ?? '', /--production/)
  // An unknown flag stops it: seed-barkpark ignores --help and resets anyway (2026-10-15).
  for (const flag of ['--help', '-h', '--dry-run', '--data']) assert.match(laneResetRefusal('e2e-me', [flag]) ?? '', /takes only --no-history/, flag)
  assert.equal(laneResetRefusal('e2e-me', ['--no-history']), undefined)
})

