import assert from 'node:assert/strict'
import {test} from 'node:test'
import {canAdd, maxItems, MAX_REACHED, pasteRefused, room} from './array-max.ts'

test('canAdd: max 2 with two items is full, "Maximum items reached"; one below it is not', () => {
  const field = {validation: {max: 2}}
  assert.deepEqual(canAdd(field, ['a', 'b']), {ok: false, reason: 'Maximum items reached'})
  assert.equal(MAX_REACHED, 'Maximum items reached')
  assert.deepEqual(canAdd(field, ['a']), {ok: true}, 'removing an item lets adding back in')
  assert.deepEqual(canAdd(field, []), {ok: true})
  assert.deepEqual(canAdd(field, undefined), {ok: true}, 'an unset array')
})

test('canAdd: an array already past its max (imported) refuses adding and keeps its items', () => {
  const items = ['a', 'b', 'c', 'd']
  assert.deepEqual(canAdd({validation: {max: 2}}, items), {ok: false, reason: MAX_REACHED})
  assert.deepEqual(items, ['a', 'b', 'c', 'd'])
})

test('maxItems: Sanity reads the first max at any level; no max, no limit', () => {
  assert.equal(maxItems({max: 3, level: 'warning'}), 3, "a warning's max stops adding too, as Sanity's")
  assert.equal(maxItems([{required: true}, {max: 4}, {max: 9}]), 4)
  assert.equal(maxItems([{min: 1}]), undefined)
  assert.equal(maxItems({max: '2026-01-01'}), undefined, 'a date max is not an item count')
  assert.equal(maxItems(undefined), undefined)
  assert.deepEqual(canAdd({}, Array(500).fill('x')), {ok: true})
})

test('room: a drop of files takes only what fits', () => {
  assert.equal(room({validation: {max: 3}}, ['a']), 2)
  assert.equal(room({validation: {max: 3}}, ['a', 'b', 'c', 'd']), 0)
  assert.equal(room({}, ['a']), Infinity)
})

test('pasteRefused: a paste may not push an array past its max; a shorter one may replace it', () => {
  const field = {validation: {max: 2}}
  assert.equal(pasteRefused(field, ['a'], ['a', 'b']), false)
  assert.equal(pasteRefused(field, ['a', 'b'], ['a', 'b', 'c']), true, 'an appended item past the max')
  assert.equal(pasteRefused(field, ['a'], ['x', 'y', 'z']), true, 'a longer array pasted over')
  assert.equal(pasteRefused(field, ['a', 'b', 'c', 'd'], ['x']), false, 'a shorter one over an over-full array')
  assert.equal(pasteRefused({}, [], ['a', 'b', 'c']), false)
})
