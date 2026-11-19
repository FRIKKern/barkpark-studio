// task-4f9ffd240c94a270: whether a write may go ahead, by who makes it (conditions.ts mayWrite,
// the one decision; doc-lock.ts writeAllowed asks it with what the doc's panes say now; edits.ts
// only acts on the answer, and fieldrule-scan.test.ts proves it imports nothing else to decide).
// - A write by hand, Keep mine on a clash, and kept edits put back: the document lock and the field rule.
// - A document action's set is code: the document lock only, so it writes a field the form shows
//   read-only (Sanity's patch.execute), and nothing on a locked doc.
// - Kept edits are put back field by field (putBackKept); those to a field refused now are not
//   sent, and stay kept (keepPlan: kept first, then the rest dropped).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Schema} from './data.ts'
import {mayWrite, type FieldConditions, type WriteBy} from './conditions.ts'
import {paneFieldLock} from './form-lock.ts'
import {gated, hideDoc, putBackKept, showDoc, writeAllowed} from './doc-lock.ts'
import {keepPlan, keptOnly, pendingKey, type Pending} from './pending-edits.ts'
import {mint} from './persons.fixture.ts'

const admin = mint({email: 'a@example.com', name: 'A', userId: 'u2', role: 'admin', canWrite: true})
type Now = {schema: Schema | undefined; doc: Record<string, unknown>; rules: Record<string, FieldConditions> | undefined; canvas: 'hidden' | 'readOnly' | 'editable'}
// post.json's way: `approved` read-only in the form, set by an "Approve" action; `reviewNote` read-only once the stage is done.
const post = {
  name: 'post',
  title: 'Post',
  fields: [{name: 'title', type: 'string'}, {name: 'stage', type: 'string'}, {name: 'approved', type: 'boolean', readOnly: true}, {name: 'reviewNote', type: 'text', readOnly: {field: 'stage', operator: 'eq', value: 'done'}}],
} as unknown as Schema
const BY: WriteBy[] = ['hand', 'keep-mine', 'replay', 'action']

test('mayWrite: every write keeps the document lock; the field rule stops all but an action', () => {
  const answers = (docLocked: boolean, fieldReadOnly: boolean) => Object.fromEntries(BY.map((by) => [by, mayWrite(by, {docLocked, fieldReadOnly})]))
  assert.deepEqual(answers(false, false), {hand: 'ok', 'keep-mine': 'ok', replay: 'ok', action: 'ok'})
  assert.deepEqual(answers(false, true), {hand: 'field read-only', 'keep-mine': 'field read-only', replay: 'field read-only', action: 'ok'})
  assert.deepEqual(answers(true, false), {hand: 'document locked', 'keep-mine': 'document locked', replay: 'document locked', action: 'document locked'})
  assert.deepEqual(answers(true, true), {hand: 'document locked', 'keep-mine': 'document locked', replay: 'document locked', action: 'document locked'})
})

/** `run` on a pane showing `doc` to an administrator with no rules; with what the pane was told. */
function shown<T>(id: string, locked: boolean, doc: Record<string, unknown>, run: () => T): {out: T; told: string[]} {
  const told: string[] = []
  const holder = {}
  const now: Now = {schema: post, doc, rules: undefined, canvas: 'editable'}
  showDoc(id, holder, locked, paneFieldLock(() => now, admin, (p) => told.push(p)))
  try {
    return {out: run(), told}
  } finally {
    hideDoc(id, holder)
  }
}
/** writeAllowed for each kind of write to `path`. */
function on(id: string, locked: boolean, doc: Record<string, unknown>, path: string) {
  const {out, told} = shown(id, locked, doc, () => Object.fromEntries(BY.map((by) => [by, writeAllowed(by, id, path)])))
  return {allowed: out, told}
}

test("a document action sets a field the form shows read-only: written, for an administrator, with no rules; by hand it is refused and said", () => {
  assert.deepEqual(on('w1', false, {title: 'T'}, 'approved'), {allowed: {hand: false, 'keep-mine': false, replay: false, action: true}, told: ['approved', 'approved']})
  // An open field: every kind of write.
  assert.deepEqual(on('w2', false, {title: 'T'}, 'title').allowed, {hand: true, 'keep-mine': true, replay: true, action: true})
})

test('the same action on a document locked here is refused, as every write is, and nothing is said of a field', () => {
  assert.deepEqual(on('w3', true, {title: 'T'}, 'approved'), {allowed: {hand: false, 'keep-mine': false, replay: false, action: false}, told: []})
  assert.deepEqual(on('w4', true, {title: 'T'}, 'title').allowed, {hand: false, 'keep-mine': false, replay: false, action: false})
})

test('Keep mine and kept edits on a field that went read-only mid-session are refused; Keep mine is said, a replay is named by its caller', () => {
  // Another editor set the stage done, which locks reviewNote for me, and rewrote it: the clash, and my kept edit to it.
  const {allowed, told} = on('w5', false, {stage: 'done', reviewNote: 'theirs'}, 'reviewNote')
  assert.deepEqual(allowed, {hand: false, 'keep-mine': false, replay: false, action: true})
  assert.deepEqual(told, ['reviewNote', 'reviewNote'], 'by hand and Keep mine, each said once; the replay not')
  assert.deepEqual(on('w6', false, {stage: 'draft', reviewNote: 'mine'}, 'reviewNote').allowed, {hand: true, 'keep-mine': true, replay: true, action: true})
})

test('Keep mine goes through its gate: refused and said on a field read-only for me, made on an open one', () => {
  const made: string[] = []
  const keepMine = gated('keep-mine', ([, id]: [unknown, string, string]) => id, (_qc: unknown, _id: string, field: string) => void made.push(field), ([, , field]) => field)
  const {out, told} = shown('w7', false, {stage: 'done', reviewNote: 'theirs'}, () => [keepMine(null, 'w7', 'reviewNote'), keepMine(null, 'w7', 'title')])
  assert.deepEqual(out, [false, undefined])
  assert.deepEqual(made, ['title'], 'mine sent only where I may edit')
  assert.deepEqual(told, ['reviewNote'])
})

test('kept edits put back: not one to a field read-only for me is sent, and those are returned to keep and name', () => {
  const sent: [string, unknown][] = []
  const fields: [string, unknown][] = [['title', 'T2'], ['reviewNote', 'mine'], ['approved', true], ['stage', 'review']]
  const {out: refused, told} = shown('w8', false, {stage: 'done', reviewNote: 'theirs'}, () => putBackKept('w8', fields, (f, v) => void sent.push([f, v])))
  assert.deepEqual(sent, [['title', 'T2'], ['stage', 'review']])
  assert.deepEqual(refused, ['reviewNote', 'approved'])
  assert.deepEqual(told, [], 'named by the pane in one message, not one toast each')
  // A document locked here: none sent, all kept.
  sent.length = 0
  assert.deepEqual(shown('w9', true, {}, () => putBackKept('w9', fields, (f, v) => void sent.push([f, v]))).out, ['title', 'reviewNote', 'approved', 'stage'])
  assert.deepEqual(sent, [])
})

test('kept edits not put back stay kept: kept first under the page that made them, then the rest of the keys go', () => {
  const p: Pending = {at: 1, type: 'post', rev: 'r1', fields: [['title', 'T2'], ['reviewNote', 'mine']], base: [['title', 'T'], ['reviewNote', 'theirs']], tab: 'gone'}
  const keys = [pendingKey('k|post-1', 'old'), pendingKey('k|post-1', 'gone')]
  assert.deepEqual(keepPlan('k|post-1', keys, p, ['reviewNote']), {keep: [pendingKey('k|post-1', 'gone'), keptOnly(p, ['reviewNote'])], drop: [pendingKey('k|post-1', 'old')]})
  assert.deepEqual(keepPlan('k|post-1', keys, p, []), {drop: keys}, 'all put back: all go')
})

test('kept edits to a field not put back stay kept, with their bases; the rest go', () => {
  const kept: Pending = {at: 1, type: 'post', rev: 'r1', fields: [['title', 'T2'], ['reviewNote', 'mine'], ['seo.metaTitle', 'M']], base: [['title', 'T'], ['reviewNote', 'theirs'], ['seo.metaTitle', '']], tab: 'gone'}
  assert.deepEqual(keptOnly(kept, ['reviewNote']), {at: 1, type: 'post', rev: 'r1', fields: [['reviewNote', 'mine']], base: [['reviewNote', 'theirs']], tab: 'gone'})
  assert.deepEqual(keptOnly(kept, []).fields, [])
})
