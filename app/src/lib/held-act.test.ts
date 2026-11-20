// task-05dcdef359da08fc: a press on an input drawn before its code is here is done by the real one
// only if, as the box is taken away, the focus is still on the very button pressed.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {heldKey, holdAct, settleBox, takeHeld} from './held-act.ts'

const A = heldKey('photo', '/structure/post;a')
const select = {}
const upload = {}

test('a press still focused at the swap is done, and the focus goes over; both read once', () => {
  holdAct(A, 'upload', upload)
  holdAct(A, 'select', select) // the last press per box
  settleBox(A, {act: 'select', el: select}, 0)
  assert.deepEqual(takeHeld(A, 10), {act: 'select', focus: 'select'})
  assert.deepEqual(takeHeld(A, 10), {})
})

test('a press the person left (focus elsewhere, or on another button) is dropped', () => {
  holdAct(A, 'select', select)
  settleBox(A, null, 0)
  assert.deepEqual(takeHeld(A, 10), {})
  holdAct(A, 'select', select)
  settleBox(A, {act: 'upload', el: upload}, 0)
  assert.deepEqual(takeHeld(A, 10), {act: undefined, focus: 'upload'})
})

test('the focus goes over with no press held', () => {
  settleBox(A, {act: 'select', el: select}, 0)
  assert.deepEqual(takeHeld(A, 10), {act: undefined, focus: 'select'})
})

test('another page, or a swap read long ago, gets nothing', () => {
  holdAct(A, 'select', select)
  settleBox(A, {act: 'select', el: select}, 0)
  assert.deepEqual(takeHeld(heldKey('photo', '/structure/post;b'), 10), {})
  assert.deepEqual(takeHeld(A, 5_000), {})
})
