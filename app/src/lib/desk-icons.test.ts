// task-af038d8b0d769e82: one desk icon vocabulary for both Studios (barkpark priv/desk_icons.json).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import ICONS from './desk-icons.json' with {type: 'json'}
import {withIconBodies} from './desk-icon-bodies.ts'

// Every name gyldendal.no's desk uses (its migrate/desk/sanity-structure.json).
const TWIN = ['block-element', 'bolt', 'book', 'calendar', 'case', 'controls', 'copy', 'dashboard', 'documents', 'edit', 'error-outline', 'eye-closed', 'eye-open', 'filter', 'help-circle', 'home', 'image', 'info-outline', 'library', 'link', 'menu', 'olist', 'package', 'schema', 'sparkles', 'star', 'tags', 'unknown', 'user', 'users', 'warning-outline']

test('every desk icon name the twin uses has a body, and the twelve drawn before still do', () => {
  const icons = ICONS as Record<string, string>
  assert.deepEqual(TWIN.filter((n) => !icons[n]), [])
  for (const n of ['home', 'book', 'user', 'tag', 'documents', 'document-text', 'document', 'cog', 'image', 'warning-outline', 'error-outline', 'folder', 'schema']) assert.ok(icons[n], n)
  assert.ok(Object.keys(icons).length > 200)
  // Barkpark #24008: six lucide icons a migrated Sanity schema names; lucide:tags is not @sanity/icons' tags.
  for (const n of ['megaphone', 'layout-grid', 'graduation-cap', 'languages', 'user-pen', 'lucide:tags', 'lucide:megaphone']) assert.ok(icons[n], n)
  assert.notEqual(icons['lucide:tags'], icons.tags)
  // SVG bodies only: no script, no event handler.
  for (const [n, body] of Object.entries(icons)) assert.ok(!/<script|\son\w+=/i.test(body), n)
})

// task-374095d722922dde: every lucide icon gyldendal.no's twin names, as `lucide:<name>`, in its
// schemas and its list preview icon picks. schemaIcon (server/schemas.ts) sends each one's body as
// iconSvg, so TypeIcon (components/Preview.tsx) draws it, not the document icon.
const TWIN_LUCIDE = 'backpack book book-a book-copy book-dashed book-image book-open book-open-text book-plus book-text calendar-days cassette-tape circle-help clapperboard clipboard-list disc-3 download dumbbell earth file-audio files folder-open glasses globe graduation-cap headphones info languages layout-grid life-buoy list list-checks mail map megaphone message-circle-more mic-vocal monitor-play notebook-pen notebook-text package-open palette podcast presentation printer receipt-text scale scroll shapes spell-check table tablet-smartphone tags tv-minimal-play user-pen volume-2'.split(' ').map((n) => `lucide:${n}`)

test('every lucide icon the twin names gets a body, so a type icon or row icon draws it', () => {
  assert.equal(TWIN_LUCIDE.length, 56)
  const icons = ICONS as Record<string, string>
  const fallbacks = TWIN_LUCIDE.filter((icon) => !withIconBodies({icon}, icons).iconSvg)
  assert.deepEqual(fallbacks, [], `${fallbacks.length} fall back to document`)
  for (const n of TWIN_LUCIDE) assert.ok(icons[n]!.startsWith('<g transform="translate(0.5 0.5)" stroke="currentColor" stroke-width="1.2"'), n)
})
