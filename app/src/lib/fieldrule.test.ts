// task-4f9ffd240c94a270: one rule (conditions.ts fieldState) answers whether this person may
// see or edit a field, and every surface that shows or edits one asks it: the form, paste, the
// Freeform canvas with or without a layout and its bound field blocks, the save, the Presentation
// page. The first tests show what each surface does with it; the last ones list the surfaces
// from the source and fail when one does not ask, a new one included.
import assert from 'node:assert/strict'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import type {Field, Schema} from './data.ts'
import {currentUserOf, fieldState, pasteSkips, pathReadOnly, type FieldConditions, type Person} from './conditions.ts'
import {canvasAccess, freeformCanvas, paneFieldLock} from './form-lock.ts'
import {canvasLocked, docLocked, fieldLocked, hideDoc, showDoc, unlessDocLocked} from './doc-lock.ts'
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
const canvas = (schema: Schema, user: Person, rules?: Record<string, FieldConditions>) => freeformCanvas(open, {schema, doc, user, rules})

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
  for (const person of [undefined, currentUserOf(undefined), currentUserOf({email: 'a@example.com', name: 'A', userId: 'u2', role: 'admin', canWrite: true, provisional: true})]) {
    assert.equal(person, undefined)
    // The form (ConditionalField draws by fieldState).
    assert.deepEqual(fieldState('note', F('body'), doc, person, rules), {hidden: false, readOnly: true})
    assert.deepEqual(fieldState('note', F('label'), doc, person, rules), {hidden: true, readOnly: true})
    assert.deepEqual(fieldState('note', F('title'), doc, person, rules), {hidden: false, readOnly: false}, 'no rule: open')
    // The canvas.
    assert.equal(canvasAccess({schema: note, doc, user: person, rules: {'note.body': {readOnly: notAdmin}}}), 'readOnly')
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
  assert.deepEqual(fieldState('note', F('label'), doc, null, rules), {hidden: true, readOnly: false})
})

test('the save: a write to a field read-only for this person is refused and said; the rest are written', () => {
  const pane = {}
  const told: string[] = []
  const writes: [string, unknown][] = []
  let now = {schema: note as Schema | undefined, doc: doc as Record<string, unknown>, user: editor as Person, rules: {'note.label': {readOnly: notAdmin}} as Record<string, FieldConditions> | undefined, canvas: 'editable' as const as 'hidden' | 'readOnly' | 'editable'}
  showDoc('n1', pane, false, paneFieldLock(() => now, (path) => told.push(path)))
  // edits.ts: edit = unlessDocLocked(([, doc]) => doc._publishedId, write, ([, , field]) => field)
  const edit = unlessDocLocked(([, d]: [unknown, {_publishedId: string}, string, unknown]) => d._publishedId, (_qc: unknown, _d: {_publishedId: string}, field: string, value: unknown) => (writes.push([field, value]), true), ([, , field]) => field)
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
  let now = {schema: stageLock as Schema | undefined, doc: {...doc} as Record<string, unknown>, user: editor as Person, rules: undefined as Record<string, FieldConditions> | undefined, canvas: 'editable' as 'hidden' | 'readOnly' | 'editable'}
  showDoc('n3', pane, false, paneFieldLock(() => now, (path) => told.push(path)))
  const edit = unlessDocLocked(([id]: [string, string, unknown]) => id, (_id: string, field: string, value: unknown) => ((written[field] = value), true), ([, field]) => field)
  assert.equal(edit('n3', 'label', 'mine'), true, 'typed while open')
  now = {...now, doc: {...now.doc, label: 'mine', stage: 'done'}} // another editor's write arrives: no edit, no check
  assert.equal(edit('n3', 'label', 'L'), false, 'Undo puts the old label back: refused')
  assert.deepEqual(told, ['label'])
  assert.deepEqual(written, {label: 'mine'})
  hideDoc('n3', pane)
})

// ── Every surface asks ─────────────────────────────────────────────────────────────────────────
const SRC = fileURLToPath(new URL('..', import.meta.url))
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [join(dir, n)] : []))
const tree = () => Object.fromEntries(files(SRC).map((f) => [relative(SRC, f), readFileSync(f, 'utf8')]))

/** What makes a source file a surface: it draws a field's input, or writes a field. */
const MARKERS: [string, RegExp][] = [
  ['draws a field', /<(FieldView|FieldBody|FieldInput|PortableDocEditor)\b/],
  ['writes a field (edit)', /import\s*\{[^}]*\bedit\b[^}]*\}\s*from\s*'[^']*\/edits'/],
  ['writes a field (edits.ts itself)', /^export const edit = /m],
  ['writes blocks (a canvas batch)', /\bapplyBlockOps\(/],
  ['pastes into a field', /\bpaste(Field|Document)\(/],
]

/**
 * Every surface, what it is, and how it asks the one rule: each pattern must be in the file.
 * A file that draws fields only through FieldView asks through it (Fields.tsx: ConditionalField).
 */
const SURFACES: Record<string, {what: string; asks: RegExp[]}> = {
  'components/Fields.tsx': {
    what: 'the form, every field at any depth; Paste field; a richText field’s canvas',
    asks: [/dependsOnDoc\(/, /fieldState\(type, props\.field, doc, user/, /<FieldBody \{\.\.\.props\} readOnly=\{props\.readOnly \|\| readOnly\} \/>/, /pasteField\(/, /<PortableDocEditor [^>]*editable=\{!readOnly\}/],
  },
  'components/DocumentPane.tsx': {
    what: 'the group tabs; the Freeform canvas with or without a layout, its bound field blocks; the pane’s word to the save; a document action’s set',
    asks: [/fieldState\(schema\.name, f, doc, user/, /freeformCanvas\(lockState, \{schema, doc, user/, /editable=\{canvasMode === 'editable'\}/, /paneFieldLock\(/, /showDoc\(pane\.id, lockHolder, locked, fieldLock\)/, /<FieldView /],
  },
  'components/DocHeaderMenu.tsx': {what: 'Paste document', asks: [/pasteDocument\(/]},
  'lib/paste-locked.ts': {what: 'what Paste field and Paste document keep, at any depth', asks: [/fieldLock\(c\.type, sub, c\.doc, c\.user/, /pasteSkips\(c\.type, fields, c\.doc, c\.user/]},
  'components/ObjectArrayInput.tsx': {what: 'an array item’s fields', asks: [/<FieldView /]},
  'components/BlockObjectDialog.tsx': {what: 'a rich-text object’s dialog', asks: [/<FieldView /]},
  'components/ImageInput.tsx': {what: 'an image’s own fields', asks: [/<FieldView /]},
  'components/PortableDocEditor.tsx': {what: 'the canvas’s save', asks: [/canvasLocked\(id, field\)/]},
  'components/TranslationsMenu.tsx': {what: 'the language field, set from the menu: judged at the save (edits.ts)', asks: [/\bedit\(qc, /]},
  'lib/edits.ts': {what: 'the save of every field edit', asks: [/^export const edit = unlessDocLocked\(\(\[, doc\]\) => doc\._publishedId, write, \(\[, , field\]\) => field\)$/m]},
  'lib/presentation-overlay.ts': {what: 'a change made on the Presentation page (no pane need show the doc)', asks: [/pathReadOnly\(/]},
}

/** The rule's own parts: nowhere but conditions.ts. */
const COPIES = /\.hidden === true|\.readOnly === true|\.visibleWhen\b|\bresolveConditional\(|\bisHidden\(|\bisReadOnly\(/

function judge(src: Record<string, string>, surfaces = SURFACES) {
  const problems: string[] = []
  for (const [file, text] of Object.entries(src)) {
    const marks = MARKERS.filter(([, re]) => re.test(text)).map(([m]) => m)
    if (marks.length && !surfaces[file]) problems.push(`${file} ${marks.join(', ')} and is no listed surface: list it in fieldrule.test.ts SURFACES with how it asks the rule`)
    if (file !== 'components/Fields.tsx' && /<(FieldBody|FieldInput)\b/.test(text)) problems.push(`${file} draws a field input past FieldView, which asks the rule`)
    if (file !== 'lib/conditions.ts' && COPIES.test(text)) problems.push(`${file} decides a field's hidden or read-only itself: ask lib/conditions.ts`)
  }
  for (const [file, {asks}] of Object.entries(surfaces)) {
    if (!(file in src)) problems.push(`${file} is listed and gone: take it off`)
    else for (const re of asks) if (!re.test(src[file]!)) problems.push(`${file} no longer asks the rule: ${re}`)
  }
  return problems
}

test('every surface that shows or edits a field asks the one rule; none decides it itself', () => {
  assert.deepEqual(judge(tree()), [])
  // The helpers the surfaces ask are built on fieldState, the one rule.
  const src = tree()
  assert.match(src['lib/form-lock.ts']!, /canvasFields\(schema\)\.map\(\(f\) => fieldState\(/)
  assert.match(src['lib/form-lock.ts']!, /pathReadOnly\(schema\.name, schema\.fields, doc, user, rules, path\)/)
  assert.match(src['lib/conditions.ts']!, /if \(fieldState\(type, f, doc, person, rules, \{path: at/)
  assert.match(src['lib/conditions.ts']!, /const readOnly = fieldState\(type, f, doc, currentUser, rules, at\)\.readOnly/)
})

test('a new surface that does not ask fails, as does a listed one that stops asking', () => {
  const src = tree()
  const added = {...src, 'components/QuickEdit.tsx': "import {edit} from '../lib/edits'\nexport const QuickEdit = () => null\n"}
  assert.match(judge(added).join('\n'), /components\/QuickEdit\.tsx writes a field \(edit\) and is no listed surface/)
  const drawn = {...src, 'components/Peek.tsx': 'export const Peek = (p: never) => <FieldBody {...p} />\n'}
  assert.match(judge(drawn).join('\n'), /Peek\.tsx draws a field input past FieldView/)
  const own = {...src, 'components/Badge.tsx': 'export const shows = (f: {hidden?: boolean}) => !(f.hidden === true)\n'}
  assert.match(judge(own).join('\n'), /Badge\.tsx decides a field's hidden or read-only itself/)
  const stopped = {...src, 'components/PortableDocEditor.tsx': src['components/PortableDocEditor.tsx']!.replace('canvasLocked(id, field)', 'false')}
  assert.match(judge(stopped).join('\n'), /PortableDocEditor\.tsx no longer asks the rule/)
})
