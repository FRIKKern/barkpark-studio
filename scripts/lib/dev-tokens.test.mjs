import assert from 'node:assert/strict'
import {test} from 'node:test'
import {editorPermissions} from './dev-tokens.mjs'

test('dev sign-in mints each editor with their configured permissions: editor d read-only', () => {
  assert.deepEqual(editorPermissions('studio-editor-d@example.com'), ['read'])
  assert.deepEqual(editorPermissions('Studio-Editor-D@example.com'), ['read'])
  assert.deepEqual(editorPermissions('studio-editor-a@example.com'), ['read', 'write'])
})
