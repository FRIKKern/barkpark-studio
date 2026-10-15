import {test} from 'node:test'
import assert from 'node:assert/strict'
import {keptKey} from './kept-words.ts'

test('task-78bb96e068c0550a: a failed save kept for one editor is never offered to another in this browser', () => {
  const at = (editor: string | null) => keptKey('{"workspace":"ws"}', editor, 'post', 'post-01', 'body')
  assert.equal(at('k-a'), at('k-a'))
  assert.notEqual(at('k-a'), at('k-b'))
  assert.notEqual(at('k-a'), at(null)) // shared sign-in keeps its own
  assert.ok(at('k-a').startsWith('bp-kept-words:')) // sign out clears the prefix (lib/sign-out.ts)
})
