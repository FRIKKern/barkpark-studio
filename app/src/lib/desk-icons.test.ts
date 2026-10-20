// task-af038d8b0d769e82: one desk icon vocabulary for both Studios (barkpark priv/desk_icons.json).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import ICONS from './desk-icons.json' with {type: 'json'}

// Every name gyldendal.no's desk uses (its migrate/desk/sanity-structure.json).
const TWIN = ['block-element', 'bolt', 'book', 'calendar', 'case', 'controls', 'copy', 'dashboard', 'documents', 'edit', 'error-outline', 'eye-closed', 'eye-open', 'filter', 'help-circle', 'home', 'image', 'info-outline', 'library', 'link', 'menu', 'olist', 'package', 'schema', 'sparkles', 'star', 'tags', 'unknown', 'user', 'users', 'warning-outline']

test('every desk icon name the twin uses has a body, and the twelve drawn before still do', () => {
  const icons = ICONS as Record<string, string>
  assert.deepEqual(TWIN.filter((n) => !icons[n]), [])
  for (const n of ['home', 'book', 'user', 'tag', 'documents', 'document-text', 'document', 'cog', 'image', 'warning-outline', 'error-outline', 'folder', 'schema']) assert.ok(icons[n], n)
  assert.ok(Object.keys(icons).length > 200)
  // SVG bodies only: no script, no event handler.
  for (const [n, body] of Object.entries(icons)) assert.ok(!/<script|\son\w+=/i.test(body), n)
})
