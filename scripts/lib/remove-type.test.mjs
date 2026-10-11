import assert from 'node:assert/strict'
import {test} from 'node:test'
import {planRemoveType} from './remove-type.mjs'

const base = {type: 'scoutThing', dataset: 'e2e-me', docs: [], inFixtures: false, seeded: false, registered: true}
const docs = [{id: 'a'}, {id: 'b'}]

test('remove-type: refuses production, a type still in the fixtures or the seed, and docs without --with-docs', () => {
  assert.match(planRemoveType({...base, dataset: 'production'}).refuse, /--production/)
  assert.equal(planRemoveType({...base, dataset: 'production', production: true}).refuse, undefined)
  assert.match(planRemoveType({...base, inFixtures: true}).refuse, /fixtures\/barkpark-schema/)
  assert.match(planRemoveType({...base, seeded: true}).refuse, /TYPES/)
  assert.match(planRemoveType({...base, docs}).refuse, /2 scoutThing document\(s\).*--with-docs/)
  assert.match(planRemoveType({...base, type: '--yes'}).refuse, /needs a type name/)
})

test('remove-type: already gone is done, not refused', () => {
  const plan = planRemoveType({...base, registered: false})
  assert.equal(plan.refuse, undefined)
  assert.match(plan.done, /nothing to do/)
})

test('remove-type: the docs go first (forced, as a reset deletes), then the schema', () => {
  assert.deepEqual(planRemoveType(base), {deletes: [], dropSchema: true})
  assert.deepEqual(planRemoveType({...base, docs, withDocs: true}), {
    deletes: [{delete: {id: 'a', type: 'scoutThing', force: true}}, {delete: {id: 'b', type: 'scoutThing', force: true}}],
    dropSchema: true,
  })
  // Left-over docs of a type whose schema is already gone: they still go.
  assert.deepEqual(planRemoveType({...base, docs, withDocs: true, registered: false}).dropSchema, false)
})
