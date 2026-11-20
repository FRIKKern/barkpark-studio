// task-05dcdef359da08fc: a press on an input drawn before its code is here is kept for the real one.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {holdAct, noteFocus, takeHeld} from './held-act.ts'

test('the last press and the focus are kept per box, and read once', () => {
  holdAct('photo', 'upload')
  holdAct('photo', 'select')
  noteFocus('photo', 'select')
  holdAct('attachment', 'menu')
  assert.deepEqual(takeHeld('photo'), {act: 'select', focused: 'select'})
  assert.deepEqual(takeHeld('photo'), {act: undefined, focused: undefined})
  assert.deepEqual(takeHeld('attachment'), {act: 'menu', focused: undefined})
})

test('a focus that left the box is not put back', () => {
  noteFocus('photo', 'upload')
  noteFocus('photo', null)
  assert.deepEqual(takeHeld('photo'), {act: undefined, focused: undefined})
})
