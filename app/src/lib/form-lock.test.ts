import {test} from 'node:test'
import assert from 'node:assert/strict'
import {formLocked, freeformCanvas, unlessLocked} from './form-lock.ts'

const open = {published: false, revision: false, gone: false, scheduled: false, canWrite: true}

test('form lock: the draft view edits; Published, a revision, a deleted or scheduled doc, a seat that cannot write do not', () => {
  assert.equal(formLocked(open), false)
  for (const k of ['published', 'revision', 'gone', 'scheduled'] as const) assert.equal(formLocked({...open, [k]: true}), true, k)
  assert.equal(formLocked({...open, canWrite: false}), true)
})

test('form lock: an edit while locked writes nothing, read when it is called, not when made', () => {
  const writes: unknown[] = []
  let locked = false
  const edit = unlessLocked(() => locked, (field: string, value: unknown) => (writes.push([field, value]), true))
  assert.equal(edit('title', 'a'), true)
  locked = true // the pane went to Published after the edit function was made
  assert.equal(edit('title', 'b'), false)
  locked = false
  edit('title', 'c')
  assert.deepEqual(writes, [['title', 'a'], ['title', 'c']])
})

test('form lock: the Freeform canvas is not drawn over Published or a revision, and is read-only where the form is locked', () => {
  assert.equal(freeformCanvas(open), 'editable')
  for (const k of ['published', 'revision'] as const) assert.equal(freeformCanvas({...open, [k]: true}), 'hidden', k)
  for (const k of ['gone', 'scheduled'] as const) assert.equal(freeformCanvas({...open, [k]: true}), 'readOnly', k)
  assert.equal(freeformCanvas({...open, canWrite: false}), 'readOnly')
})
