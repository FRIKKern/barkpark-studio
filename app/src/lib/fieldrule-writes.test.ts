// task-4f9ffd240c94a270: the writes around the save, as the one rule leaves them.
// - A document action's set is the action's code, not an edit by hand: the document lock only, so
//   it writes a field the form shows read-only (Sanity's patch.execute), and nothing on a locked doc.
// - "Keep mine" on a clash is an edit by hand: refused and said on a field read-only for this person
//   now, and the card offers theirs and shows their words to copy.
// - Kept edits to such a field are not put back, not deleted, and named; never "were put back".
// edits.ts runs only in the app (its server functions), so each gate is built here as edits.ts
// builds it, from the line read out of edits.ts, with the real doc-lock and pane lock.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import type {Schema} from './data.ts'
import type {FieldConditions, Person} from './conditions.ts'
import {currentUserOf} from './conditions.ts'
import {paneFieldLock} from './form-lock.ts'
import {hideDoc, showDoc, unlessDocLocked} from './doc-lock.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const edits = read('./edits.ts')
const pane = read('../components/DocumentPane.tsx')
const admin = currentUserOf({email: 'a@example.com', name: 'A', userId: 'u2', role: 'admin', canWrite: true})
// post.json's way: `approved` read-only in the form, set by an "Approve" action.
const post = {name: 'post', title: 'Post', fields: [{name: 'title', type: 'string'}, {name: 'approved', type: 'boolean', readOnly: true}]} as unknown as Schema
type Now = {schema: Schema | undefined; doc: Record<string, unknown>; user: Person; rules: Record<string, FieldConditions> | undefined; canvas: 'hidden' | 'readOnly' | 'editable'}

/** The action's set as DocumentPane and edits.ts make it: setByAction, the document lock and no field getter. */
function actionSet(writes: [string, unknown][]) {
  assert.match(pane, /const set = \(field: string, value: unknown\) => setByAction\(qc, doc, field, value\) !== false/, "DocumentPane: an action's set is setByAction")
  assert.match(edits, /^export const setByAction = unlessDocLocked\(\(\[, doc\]: Parameters<typeof write>\) => doc\._publishedId, write\)$/m, 'edits.ts: setByAction keeps the document lock only')
  const write = (_qc: unknown, _doc: {_publishedId: string}, field: string, value: unknown) => void writes.push([field, value])
  const setByAction = unlessDocLocked(([, doc]: Parameters<typeof write>) => doc._publishedId, write)
  return (id: string, field: string, value: unknown) => setByAction(null, {_publishedId: id}, field, value) !== false
}

test("a document action sets a field the form shows read-only: written, for an administrator, with no rules", () => {
  const told: string[] = []
  const writes: [string, unknown][] = []
  const holder = {}
  const now: Now = {schema: post, doc: {title: 'T'}, user: admin, rules: undefined, canvas: 'editable'}
  showDoc('p1', holder, false, paneFieldLock(() => now, (path) => told.push(path)))
  try {
    assert.equal(actionSet(writes)('p1', 'approved', true), true)
    assert.deepEqual(writes, [['approved', true]])
    assert.deepEqual(told, [], 'no refusal said')
  } finally {
    hideDoc('p1', holder)
  }
})

test('the same action on a document locked here is refused, and writes nothing', () => {
  const writes: [string, unknown][] = []
  const holder = {}
  const now: Now = {schema: post, doc: {title: 'T'}, user: admin, rules: undefined, canvas: 'editable'}
  showDoc('p2', holder, true, paneFieldLock(() => now, () => {}))
  try {
    assert.equal(actionSet(writes)('p2', 'approved', true), false)
    assert.equal(actionSet(writes)('p2', 'title', 'T2'), false)
    assert.deepEqual(writes, [])
  } finally {
    hideDoc('p2', holder)
  }
})

test('Keep mine on a field read-only for me now is refused and said; the card offers theirs and shows my words', async () => {
  // The clash: another editor set stage done, which locks reviewNote for me, and rewrote reviewNote.
  const {fieldRefused} = (await import('./doc-lock.ts')) as {fieldRefused?: (id: string, path: string) => boolean}
  assert.equal(typeof fieldRefused, 'function', 'doc-lock: fieldRefused, what Keep mine asks')
  const told: string[] = []
  const holder = {}
  const note = {name: 'post', title: 'Post', fields: [{name: 'stage', type: 'string'}, {name: 'reviewNote', type: 'text', readOnly: {field: 'stage', operator: 'eq', value: 'done'}}]} as unknown as Schema
  const now: Now = {schema: note, doc: {stage: 'done', reviewNote: 'theirs'}, user: admin, rules: undefined, canvas: 'editable'}
  showDoc('p3', holder, false, paneFieldLock(() => now, (path) => told.push(path)))
  try {
    assert.equal(fieldRefused!('p3', 'reviewNote'), true)
    assert.deepEqual(told, ['reviewNote'])
    assert.equal(fieldRefused!('p3', 'stage'), false, 'an open field keeps mine')
  } finally {
    hideDoc('p3', holder)
  }
  // settleClash asks it before the clash is settled, so a refused Keep mine leaves the card up.
  const settle = edits.slice(edits.indexOf('export function settleClash('))
  assert.ok(settle.indexOf("if (keep === 'mine' && fieldRefused(id, field)) return") >= 0, 'settleClash asks the rule for Keep mine')
  assert.ok(settle.indexOf("fieldRefused(id, field)) return") < settle.indexOf('e.clashes.delete(field)'), 'before the clash is settled')
  // The card: no Keep mine on a read-only field; Take theirs, my words and Copy mine stay.
  const card = read('../components/FieldClash.tsx')
  assert.match(card, /\{!readOnly && \(\s*<button type="button" className="btn-text" onClick=\{\(\) => settleClash\(qc, id, path, 'mine'\)\}>/)
  assert.match(card, /<dd data-version="mine">\{show\(clash\.mine\)\}<\/dd>/)
  assert.match(card, /settleClash\(qc, id, path, 'theirs'\)/)
  assert.match(card, /\{t\('Copy mine'\)\}/)
  assert.match(read('../components/Fields.tsx'), /<FieldClashCard path=\{props\.path\} readOnly=\{!!props\.readOnly\} \/>/)
})

test('kept edits to a field read-only for me are not sent, not deleted, and named; never "were put back"', () => {
  const recover = edits.slice(edits.indexOf('export async function recoverPending('), edits.indexOf('export function discardPending('))
  // Not sent: put back only where the rule lets this person write, judged per field.
  assert.match(recover, /const refused = fields\.flatMap\(\(\[f\]\) => \(fieldLocked\(id, f\) \? \[f\] : \[\]\)\)\n\s*for \(const \[f, v\] of fields\) if \(!refused\.includes\(f\)\) put\(f, v\)/)
  assert.equal(recover.match(/putBack\(/g)?.length, 3, 'recoverPending and restorePending both put back through it')
  assert.doesNotMatch(recover, /keys\.forEach\(\(k\) => void dropPending\(k\)\)\n\s*return \{replayed/, 'not every kept edit dropped')
  // Not deleted: the refused ones are kept again under the page that made them.
  assert.match(recover, /putPending\(pendingKey\(key, pending\.tab\), \{\.\.\.pending, fields: pending\.fields\.filter\(\(\[f\]\) => kept\(f\)\)/)
  // Named, and "were put back" only when none was refused.
  assert.match(pane, /if \(!r\.refused\.length\) return toast\(\{title: tt\('Unsaved changes from \{date\} were put back\.', \{date\}\)\}\)\n\s*notPutBack\(r\.refused, date, r\.put > 0\)/)
  assert.match(pane, /const refused = restorePending\(qc, doc, recovered\)\n\s*if \(refused\?\.length\) notPutBack\(/)
  assert.match(pane, /'Unsaved changes to \{fields\} from \{date\} were not put back: read-only for you\. They are kept in this browser\.'/)
})
