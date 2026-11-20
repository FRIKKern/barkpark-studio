// task-96c28256661a6179: D04's "not yet edited" (lib/pane-clock.ts unedited) is noted at one door, the
// write path in lib/edits.ts, so every writer is seen: a keystroke, an array's Add or move, an undo,
// an action's set, a put-back. The units run edits.ts as it is (its server side stubbed, as
// save-flow.test.ts); the scans hold the door: a new way to write a document that skips it goes red.
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import {register} from 'node:module'
import {after, test} from 'node:test'
import {QueryClient} from '@tanstack/react-query'

register('./save-flow.hooks.mjs', import.meta.url)
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})
const {edit, undo, forgetEdits} = await import('./edits.ts')
const {unedited} = await import('./pane-clock.ts')
after(() => forgetEdits())

/** A doc made a moment ago, never edited: its create stamps both times alike. */
const justMade = (id: string) => {
  const at = new Date().toISOString()
  return {_id: `drafts.${id}`, _publishedId: id, _type: 'post', _rev: 'r1', _draft: true, _hasPublished: false, _createdAt: at, _updatedAt: at, tags: []} as never
}
const page = (doc: never) => {
  const qc = new QueryClient()
  qc.setQueryData(['doc', (doc as {_publishedId: string})._publishedId], doc)
  return qc
}

test('edit() on a just-made doc: not unedited any more, before its save lands', () => {
  const doc = justMade('door-edit')
  const qc = page(doc)
  assert.equal(unedited(doc, 'door-edit'), true, 'unedited as made')
  assert.notEqual(edit(qc, doc, 'tags', ['x']), false, 'the edit was taken')
  assert.equal(unedited(doc, 'door-edit'), false)
})

test('undo() on a just-made doc: not unedited, the undo written through the same door', () => {
  const doc = justMade('door-undo')
  const qc = page(doc)
  edit(qc, doc, 'tags', ['x'])
  assert.equal(undo(qc, 'door-undo'), 'tags', 'the undo changed the field')
  assert.deepEqual((qc.getQueryData(['doc', 'door-undo']) as {tags: unknown}).tags, [], 'and put it back')
  assert.equal(unedited(doc, 'door-undo'), false)
})

const SRC = new URL('../', import.meta.url)
const files = (dir: string): string[] =>
  readdirSync(new URL(dir, SRC), {withFileTypes: true}).flatMap((d) => (d.isDirectory() ? files(`${dir}${d.name}/`) : /\.tsx?$/.test(d.name) && !/\.test\.|\.gen\./.test(d.name) ? [`${dir}${d.name}`] : []))
const all = new Map(['lib/', 'components/', 'routes/', 'server/'].flatMap(files).map((f) => [f, readFileSync(new URL(f, SRC), 'utf8')]))
const edits = all.get('lib/edits.ts')!
/** A top-level function's (or const's) source in edits.ts, up to the next top-level declaration. */
const body = (name: string) => edits.match(new RegExp(`\\n(?:export )?(?:async )?(?:function|const) ${name}\\b[\\s\\S]*?(?=\\n(?:export |async |function |const |type |/\\*\\*)|$)`))?.[0] ?? ''

test('the door: noteEdit is called in edits.ts write() and the canvas step only, and every field writer there reaches write()', () => {
  const calls = [...all].flatMap(([f, s]) => [...s.matchAll(/\bnoteEdit\(/g)].map(() => f))
  assert.deepEqual(calls, ['lib/edits.ts', 'lib/edits.ts'], 'two calls, both in edits.ts')
  assert.match(body('write'), /\n {2}noteEdit\(id\)\n/, 'write() notes, unconditionally')
  assert.match(body('bodyHistory'), /if \(kind === 'step'\) \{\n.*\n {4}noteEdit\(id\)\n/, "the canvas's step notes (its batches go out by lib/blocks.ts)")
  // The field writers (a reload's put-back too), found two ways: by name, and as edits.ts's exports whose body calls write( or edit(.
  const named = ['edit', 'setByAction', 'undo', 'recoverPending', 'restorePending', 'reapply']
  const found = [...edits.matchAll(/\nexport (?:async )?(?:function|const) (\w+)/g)].map((m) => m[1]!).filter((n) => /[\s(,]write[(,]|[\s;>]edit\(/.test(body(n).slice(n.length + 8)))
  assert.ok(found.length > 0)
  assert.deepEqual(found.sort(), named.sort())
  // edits.ts's own sends: the save loop (what write() put in `dirty`) and the publish/delete verbs, no field set.
  const sends = [...edits.matchAll(/await mutate\(\{data: \{mutations(?:: )?([^}]*?)[}\]]/g)].map((m) => m[1]!)
  assert.deepEqual(sends, ['', '[...strengthen, {publish: {id, type: doc._type', '[{delete: {id, type: doc._type', '[{unpublish: {id, type: doc._type', '[{discardDraft: {id, type: doc._type'])
})

// The studio's document writes, each a server function. Its files found two ways: by the routes it
// sends to, and by where the writers are defined. Writes of the studio's own kept types (comments,
// tasks, shared queries) never reach a document pane.
const WRITERS: Record<string, string> = {mutate: 'lib/edits.ts', applyBlockOps: 'lib/blocks.ts', restoreRevision: 'lib/history.ts', runDocAction: 'lib/doc-actions.ts', disconnectReferences: 'lib/data.ts', saveRanks: 'lib/order-save.ts'}
const OWN_TYPES = ['lib/comments.ts', 'lib/tasks.ts', 'lib/vision-shared.ts', 'routes/api/mutate.ts']
/** Who calls a writer, and why that is not a bypass of the door. */
const CALLERS: Record<string, string> = {
  'components/PortableDocEditor.tsx': "the canvas's batches: its history step reaches bodyHistory('step'), which notes",
  'components/HistoryPanel.tsx': 'a restore writes the doc again: Barkpark stamps _updatedAt past _createdAt (writer.ex:2674), read by unedited',
  'components/PaneBanners.tsx': 'the same restore',
  'components/SchemaActions.tsx': "a document action runs on Barkpark: its write is stamped as a restore's",
  'components/UnpublishDialog.tsx': 'writes the documents that reference this one, not this one',
  'components/OrderableRows.tsx': "a list's rank writes, to docs that exist: stamped as a restore's",
  'lib/bulk-run.ts': 'creates a copy: a new doc, quiet as just made is right',
  'lib/translations.ts': 'creates a translation and its metadata: new docs, quiet as just made',
}

test('every document write outside edits.ts: its files found two ways, and each caller known', () => {
  const routes = /\/data\/mutate\/|\/restore\?|\/disconnect\/|\/ops`|\/papers\/\$\{[^}]+\}\/ops|encodeURIComponent\(data\.name\)\}\?mode=/
  const sending = [...all].filter(([, s]) => routes.test(s)).map(([f]) => f)
  const defining = Object.values(WRITERS)
  assert.ok(sending.length > 0)
  assert.deepEqual(sending.sort(), [...new Set([...defining, ...OWN_TYPES, 'lib/order-save.ts'])].sort(), 'the files that send a document write')
  for (const [name, f] of Object.entries(WRITERS)) assert.match(all.get(f)!, new RegExp(`\\nexport const ${name} = `), `${name} is exported by ${f}`)
  // Callers: by import (an alias too), and by call (not a method's own: table-sim.ts's mutate). Both sets must agree.
  const names = Object.keys(WRITERS).join('|')
  const importing = [...all].filter(([f, s]) => !defining.includes(f) && new RegExp(`import \\{[^}]*\\b(${names})\\b[^}]*\\} from '[./]+(lib/)?(${Object.values(WRITERS).map((w) => w.slice(4, -3)).join('|')})'`).test(s)).map(([f]) => f)
  const calling = [...all].filter(([f, s]) => !defining.includes(f) && new RegExp(`(?<![.\\w])(?<!^[ \\t]*)(${names})\\(`, 'm').test(s)).map(([f]) => f)
  assert.ok(importing.length > 0)
  assert.deepEqual(calling.sort(), importing.sort(), 'every importer calls by name, every caller imports')
  assert.deepEqual(importing.sort(), Object.keys(CALLERS).sort(), 'a new caller says here why it is not a write past the door')
})
