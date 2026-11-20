// task-05dcdef359da08fc: a press on an image or file input drawn before its code is here is done by
// the real one only if, as the box is taken away, the focus is still on the very button pressed, on
// the same page. One decision (afterSwap); each test names the case it holds (review of #1337).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {afterSwap, holdAct, settleBox, takeHeld, type Pressed} from './held-act.ts'

const A = '/structure/post;a'
const B = '/structure/post;b'
const select = {name: 'Select button'}
const upload = {name: 'Upload button'}
const on = (act: Pressed['act'], el: unknown) => ({act, el})

test('a held press still focused at the swap, on its own page, is done; the focus goes over', () => {
  assert.deepEqual(afterSwap({act: 'select', button: select, route: A}, {focused: on('select', select), route: A}, A, 5), {act: 'select', focus: 'select'})
  assert.deepEqual(afterSwap({act: 'upload', button: upload, route: A}, {focused: on('upload', upload), route: A}, A, 5), {act: 'upload', focus: 'upload'})
})

test('P1/P2: a held Select or Upload, then typing in Title: nothing in the box has the focus, the press is dropped', () => {
  assert.deepEqual(afterSwap({act: 'select', button: select, route: A}, {focused: null, route: A}, A, 5), {act: undefined, focus: undefined})
  assert.deepEqual(afterSwap({act: 'upload', button: upload, route: A}, {focused: null, route: A}, A, 5), {act: undefined, focus: undefined})
})

test('P3: a Select held on one document does nothing on the next one', () => {
  // The press was made on A; the box that swaps is B's (same field path), on B.
  assert.deepEqual(afterSwap({act: 'select', button: select, route: A}, {focused: null, route: B}, B, 5), {act: undefined, focus: undefined})
  // Even with the focus on B's own Select (a different button) at its swap.
  assert.deepEqual(afterSwap({act: 'select', button: select, route: A}, {focused: on('select', {}), route: B}, B, 5), {act: undefined, focus: 'select'})
  // And a swap read on A is not used by an input mounting on B.
  assert.deepEqual(afterSwap({act: 'select', button: select, route: A}, {focused: on('select', select), route: A}, B, 5), {})
})

test('a held Select, then a click on an empty spot: the press is dropped', () => {
  assert.deepEqual(afterSwap({act: 'select', button: select, route: A}, {focused: null, route: A}, A, 5), {act: undefined, focus: undefined})
})

test('Safari: a pressed button that never had the focus, or the focus on another button, drops the press', () => {
  assert.deepEqual(afterSwap({act: 'select', button: select, route: A}, {focused: null, route: A}, A, 5).act, undefined)
  assert.deepEqual(afterSwap({act: 'select', button: select, route: A}, {focused: on('upload', upload), route: A}, A, 5), {act: undefined, focus: 'upload'})
})

test('the focus goes over to the live box with no press held', () => {
  assert.deepEqual(afterSwap(undefined, {focused: on('select', select), route: A}, A, 5), {act: undefined, focus: 'select'})
})

test('a swap read long before the real input mounts is never used', () => {
  assert.deepEqual(afterSwap({act: 'select', button: select, route: A}, {focused: on('select', select), route: A}, A, 5_000), {})
})

test('the store: the last press per box, decided at the swap, read once', () => {
  holdAct('photo', 'upload', upload, A)
  holdAct('photo', 'select', select, A)
  settleBox('photo', on('select', select), A, 0)
  assert.deepEqual(takeHeld('photo', A, 10), {act: 'select', focus: 'select'})
  assert.deepEqual(takeHeld('photo', A, 10), {})
})
