import assert from 'node:assert/strict'
import {test} from 'node:test'
import {atMax, maxItems, MAX_REACHED, pasteAllowed, room} from './array-max.ts'

test('atMax: max 2 with two items is full; one below it is not; past it (imported) is full too', () => {
  assert.equal(atMax(2, 2), true)
  assert.equal(MAX_REACHED, 'Maximum items reached')
  assert.equal(atMax(2, 1), false, 'removing an item lets adding back in')
  assert.equal(atMax(2, 0), false)
  assert.equal(atMax(2, 4), true, 'an array already past its max')
  assert.equal(atMax(0, 0), true, 'max(0): nothing may be added, as Sanity')
  assert.equal(atMax(undefined, 500), false, 'no max, no limit')
})

test('maxItems: Sanity reads the first max at any level; no max, no limit', () => {
  assert.equal(maxItems({max: 3, level: 'warning'}), 3, "a warning's max stops adding too, as Sanity's")
  assert.equal(maxItems([{required: true}, {max: 4}, {max: 9}]), 4)
  assert.equal(maxItems([{min: 1}]), undefined)
  assert.equal(maxItems({max: '2026-01-01'}), undefined, 'a date max is not an item count')
  assert.equal(maxItems(undefined), undefined)
})

test('room: a drop of files takes only what fits', () => {
  assert.equal(room({validation: {max: 3}}, ['a']), 2)
  assert.equal(room({validation: {max: 3}}, ['a', 'b', 'c', 'd']), 0)
  assert.equal(room({}, ['a']), Infinity)
})

test('pasteAllowed: an item appended at the max is refused; a paste that replaces the array is not', () => {
  const field = {type: 'arrayOf', validation: {max: 2}}
  assert.equal(pasteAllowed(field, ['a', 'b'], ['a', 'b', 'c']), false, 'an item paste (append) at the max')
  assert.equal(pasteAllowed(field, ['a', 'b'], ['x', 'y']), true, 'a copied 2-item field replaces a full max-2 array')
  assert.equal(pasteAllowed(field, ['a'], ['a', 'b']), true)
  assert.equal(pasteAllowed(field, ['a'], ['x', 'y', 'z']), false, 'a longer array pasted over')
  assert.equal(pasteAllowed(field, ['a', 'b', 'c', 'd'], ['x']), true, 'a shorter one over an over-full array')
  assert.equal(pasteAllowed(field, ['a', 'b', 'c', 'd'], ['w', 'x', 'y']), true, 'a shorter over-full one over an over-full array')
  assert.equal(pasteAllowed({type: 'arrayOf'}, [], ['a', 'b', 'c']), true, 'no max')
})

test('pasteAllowed: the tags layout and an options.list checkbox list are not held to the max', () => {
  // fixtures/barkpark-schema/post.json post.tags
  const tags = {type: 'arrayOf', options: {layout: 'tags'}, validation: {max: 3, level: 'warning'}}
  assert.equal(pasteAllowed(tags, ['a', 'b', 'c'], ['a', 'b', 'c', 'd']), true)
  const list = {type: 'arrayOf', options: {list: ['a', 'b', 'c']}, validation: {max: 1}}
  assert.equal(pasteAllowed(list, ['a'], ['a', 'b']), true)
})
