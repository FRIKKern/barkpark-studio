// task-4f9ffd240c94a270: one rule (conditions.ts fieldState) answers whether this person may
// see or edit a field, and every surface that shows or edits one asks it: the form, paste, the
// Freeform canvas with or without a layout and its bound field blocks, the save, the Presentation
// page. These tests show what each surface does with it; fieldrule-scan.test.ts lists the
// surfaces from the source, and fieldrule-writes.test.ts what the writes around the save do.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Field, Schema} from './data.ts'
import {currentUserOf, fieldState, pasteSkips, pathReadOnly, UNKNOWN, type FieldConditions, type Person} from './conditions.ts'
import {nobody} from './persons.fixture.ts'
import {canvasAccess, freeformCanvas, paneFieldLock} from './form-lock.ts'
import {canvasLocked, docLocked, fieldLocked, gated, hideDoc, showDoc} from './doc-lock.ts'
import {pasteDocument} from './paste-locked.ts'

const editor = currentUserOf({email: 'e@example.com', name: 'E', userId: 'u1', role: 'member', canWrite: true})
const admin = currentUserOf({email: 'a@example.com', name: 'A', userId: 'u2', role: 'admin', canWrite: true})
const notAdmin = ({currentUser}: {currentUser: {roles: {name: string}[]} | null}) => !currentUser?.roles.some((r) => r.name === 'administrator')
const open = {published: false, revision: false, gone: false, scheduled: false, canWrite: true}

// A note as fixtures/barkpark-schema/note.json: a bound title and label block, the body region.
const note = {
  name: 'note',
  title: 'Note',
  layout: [{kind: 'field', name: 'title', max: 1}, {kind: 'field', name: 'label', max: 1}, {kind: 'region', name: 'body'}],
  fields: [{name: 'title', type: 'string'}, {name: 'label', type: 'string'}, {name: 'body', type: 'richText'}, {name: 'stage', type: 'string'}],
} as unknown as Schema
// A paper type with no layout in this workspace: the canvas holds its body, the rich-text field.
const paper = {name: 'paper', title: 'Paper', fields: [{name: 'title', type: 'string'}, {name: 'body', type: 'richText'}, {name: 'orderRank', type: 'string', hidden: true}]} as unknown as Schema
const doc = {title: 'T', label: 'L', body: {blocks: []}, stage: 'draft'}
const canvas = (schema: Schema, user: Person, rules?: Record<string, FieldConditions>) => freeformCanvas(open, user, {schema, doc, rules})

test('the Freeform canvas: a bound field block read-only for this person leaves it read-only, as its body does', () => {
  assert.equal(canvas(note, editor), 'editable')
  const labelAdminsOnly = {'note.label': {readOnly: notAdmin}}
  assert.equal(canvas(note, editor, labelAdminsOnly), 'readOnly', 'the label block')
  assert.equal(canvas(note, admin, labelAdminsOnly), 'editable')
  assert.equal(canvas({...note, fields: note.fields.map((f) => (f.name === 'title' ? {...f, readOnly: true} : f))} as Schema, admin), 'readOnly', "the schema's readOnly on a bound field")
  // A field the canvas does not hold leaves it as it is.
  assert.equal(canvas(note, editor, {'note.stage': {readOnly: true}}), 'editable')
})

test('the Freeform canvas: a body or bound field hidden from this person is not drawn; the form shows the rest', () => {
  assert.equal(canvas(note, editor, {'note.body': {hidden: notAdmin}}), 'hidden')
  assert.equal(canvas(note, editor, {'note.label': {hidden: notAdmin}}), 'hidden')
  assert.equal(canvas(note, admin, {'note.body': {hidden: notAdmin}}), 'editable')
  // Hidden by the data (visibleWhen) is hidden too: the canvas cannot leave one block out.
  const whenDone = {...note, fields: note.fields.map((f) => (f.name === 'label' ? {...f, visibleWhen: {field: 'stage', operator: 'eq', value: 'done'}} : f))} as Schema
  assert.equal(canvas(whenDone, admin), 'hidden')
})

test('the Freeform canvas without a layout: its body counts as a region does', () => {
  assert.equal(canvas(paper, editor), 'editable', 'a field never in the form is no block of it')
  assert.equal(canvas(paper, editor, {'paper.title': {readOnly: notAdmin}}), 'editable', 'a field it does not hold')
  assert.equal(canvas(paper, editor, {'paper.body': {readOnly: notAdmin}}), 'readOnly')
  assert.equal(canvas(paper, editor, {'paper.body': {hidden: notAdmin}}), 'hidden')
  assert.equal(canvas(paper, admin, {'paper.body': {readOnly: notAdmin}}), 'editable')
})

test('before the person is known, a field with a role rule is locked on every surface, and opens once they are', () => {
  const rules: Record<string, FieldConditions> = {'note.body': {readOnly: notAdmin}, 'note.label': {hidden: notAdmin}, 'note.stage': {readOnly: true}}
  const F = (name: string) => note.fields.find((f) => f.name === name)!
  for (const person of [UNKNOWN, currentUserOf(undefined), currentUserOf({email: 'a@example.com', name: 'A', userId: 'u2', role: 'admin', canWrite: true, provisional: true}), currentUserOf({email: 'a@example.com', name: 'A', userId: 'u2', role: null, canWrite: true, unchecked: true})]) {
    assert.equal(person, UNKNOWN)
    // The form (ConditionalField draws by fieldState).
    assert.deepEqual(fieldState('note', F('body'), doc, person, rules), {hidden: false, readOnly: true})
    assert.deepEqual(fieldState('note', F('label'), doc, person, rules), {hidden: true, readOnly: true})
    assert.deepEqual(fieldState('note', F('title'), doc, person, rules), {hidden: false, readOnly: false}, 'no rule: open')
    // The canvas.
    assert.equal(canvasAccess(person, {schema: note, doc, rules: {'note.body': {readOnly: notAdmin}}}), 'readOnly')
    assert.equal(canvas(note, person, rules), 'hidden')
    // Paste.
    assert.deepEqual([...pasteSkips('note', note.fields, doc, person, rules).skip].sort(), ['body', 'label', 'stage'])
    assert.deepEqual(pasteDocument(note.fields, {title: 'T2', label: 'L2'}, {type: 'note', doc, user: person, rules}).writes, [['title', 'T2']])
    // The save.
    assert.equal(pathReadOnly('note', note.fields, doc, person, rules, 'body'), true)
    assert.equal(pathReadOnly('note', note.fields, doc, person, rules, 'title'), false)
  }
  // Known: the administrator has them all; nobody signed in (shared sign-in) is known too.
  assert.equal(canvas(note, admin, {'note.body': {readOnly: notAdmin}, 'note.label': {hidden: notAdmin}}), 'editable')
  assert.deepEqual(fieldState('note', F('label'), doc, nobody, rules), {hidden: true, readOnly: false})
})

test('the save: a write to a field read-only for this person is refused and said; the rest are written', () => {
  const pane = {}
  const told: string[] = []
  const writes: [string, unknown][] = []
  let now = {schema: note as Schema | undefined, doc: doc as Record<string, unknown>, rules: {'note.label': {readOnly: notAdmin}} as Record<string, FieldConditions> | undefined, canvas: 'editable' as const as 'hidden' | 'readOnly' | 'editable'}
  showDoc('n1', pane, false, paneFieldLock(() => now, editor, (path) => told.push(path)))
  // As edits.ts's edit: gated('hand', …), a write by hand.
  const edit = gated('hand', ([, d]: [unknown, {_publishedId: string}, string, unknown]) => d._publishedId, (_qc: unknown, _d: {_publishedId: string}, field: string, value: unknown) => (writes.push([field, value]), true), ([, , field]) => field)
  const n1 = {_publishedId: 'n1'}
  assert.equal(edit(null, n1, 'title', 'T2'), true)
  assert.equal(edit(null, n1, 'label', 'L2'), false)
  assert.deepEqual(told, ['label'], 'said, not dropped quietly')
  // A path into a read-only object is refused with it.
  now = {...now, rules: {'note.seo': {readOnly: notAdmin}}, schema: {...note, fields: [...note.fields, {name: 'seo', type: 'composite', fields: [{name: 'metaTitle', type: 'string'}]} as unknown as Field]} as Schema}
  assert.equal(edit(null, n1, 'seo.metaTitle', 'M'), false)
  // The canvas's batches: the whole-document canvas while one of its fields is locked, a field canvas by its field.
  now = {...now, rules: {'note.body': {readOnly: notAdmin}}, canvas: 'readOnly'}
  assert.equal(canvasLocked('n1'), true)
  assert.equal(canvasLocked('n1', 'body'), true)
  assert.equal(canvasLocked('n1', 'title'), false)
  // Another pane on the same doc for the same person judges the same; a doc no pane shows is the caller's to judge.
  assert.equal(docLocked('n1'), false)
  assert.equal(fieldLocked('n2', 'body'), false)
  hideDoc('n1', pane)
  assert.deepEqual(writes, [['title', 'T2']])
})

// What a replay of this person's own edit does (edits.ts undo, a clash's or a recovery's put-back):
// it is a new local edit, through edit(), judged as any other. A field that went read-only meanwhile
// (another editor set the stage the rule reads) refuses it, says so, and keeps the value it has now.
// The server's own frames (applyServer, a rebase onto another editor's write) never come here.
test('the save: an undo of a field that went read-only mid-session is refused and said, not written', () => {
  const pane = {}
  const told: string[] = []
  const written: Record<string, unknown> = {}
  const stageLock = {...note, fields: note.fields.map((f) => (f.name === 'label' ? {...f, readOnly: {field: 'stage', operator: 'eq', value: 'done'}} : f))} as Schema
  let now = {schema: stageLock as Schema | undefined, doc: {...doc} as Record<string, unknown>, rules: undefined as Record<string, FieldConditions> | undefined, canvas: 'editable' as 'hidden' | 'readOnly' | 'editable'}
  showDoc('n3', pane, false, paneFieldLock(() => now, editor, (path) => told.push(path)))
  const edit = gated('hand', ([id]: [string, string, unknown]) => id, (_id: string, field: string, value: unknown) => ((written[field] = value), true), ([, field]) => field)
  assert.equal(edit('n3', 'label', 'mine'), true, 'typed while open')
  now = {...now, doc: {...now.doc, label: 'mine', stage: 'done'}} // another editor's write arrives: no edit, no check
  assert.equal(edit('n3', 'label', 'L'), false, 'Undo puts the old label back: refused')
  assert.deepEqual(told, ['label'])
  assert.deepEqual(written, {label: 'mine'})
  hideDoc('n3', pane)
})
