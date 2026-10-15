import {test} from 'node:test'
import assert from 'node:assert/strict'
import {heldFor} from './held-for.ts'

test('task-03ca6c0c9a79adf1: held edits stay for their editor through a lost session, never for the next one', () => {
  const editorIs = heldFor()
  assert.equal(editorIs('a@example.com'), true)
  assert.equal(editorIs(null), true) // the session is lost (J48): kept
  assert.equal(editorIs('a@example.com'), true) // back as themselves: sent
  assert.equal(editorIs('b@example.com'), false) // someone else signs in here: dropped
  assert.equal(editorIs('b@example.com'), true) // and from then on, b's own are b's
})
