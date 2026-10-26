import {test} from 'node:test'
import assert from 'node:assert/strict'
import {serverPrefs} from './prefs-scope.ts'

test('prefs go to Barkpark only when the editor is known', () => {
  for (const mode of ['account', 'sso', 'dev'] as const) assert.equal(serverPrefs(mode), true, mode)
  // Shared: everyone works as BARKPARK_TOKEN, so one account would hold every editor's prefs.
  assert.equal(serverPrefs('shared'), false)
})
