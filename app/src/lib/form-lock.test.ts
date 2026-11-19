import {test} from 'node:test'
import assert from 'node:assert/strict'
import {formLocked, freeformCanvas, unlessLocked} from './form-lock.ts'
import {currentUserOf, type FieldConditions} from './conditions.ts'
import {nobody} from './persons.fixture.ts'
import type {Schema} from './data.ts'

const open = {published: false, revision: false, gone: false, scheduled: false, canWrite: true}

test('form lock: the draft view edits; Published, a revision, a deleted or scheduled doc, a seat that cannot write do not', () => {
  assert.equal(formLocked(open), false)
  for (const k of ['published', 'revision', 'gone', 'scheduled'] as const) assert.equal(formLocked({...open, [k]: true}), true, k)
  assert.equal(formLocked({...open, canWrite: false}), true)
})

test('form lock: an edit while locked writes nothing, read when it is called, not when made', () => {
  const writes: unknown[] = []
  let locked = false
  const edit = unlessLocked(() => locked, (field: string, value: unknown) => (writes.push([field, value]), true))
  assert.equal(edit('title', 'a'), true)
  locked = true // the pane went to Published after the edit function was made
  assert.equal(edit('title', 'b'), false)
  locked = false
  edit('title', 'c')
  assert.deepEqual(writes, [['title', 'a'], ['title', 'c']])
})

test('form lock: the Freeform canvas is not drawn over Published or a revision, and is read-only where the form is locked', () => {
  const plain = {schema: {name: 'note', title: 'Note', fields: []} as Schema, doc: {}, rules: undefined}
  assert.equal(freeformCanvas(open, nobody, plain), 'editable')
  for (const k of ['published', 'revision'] as const) assert.equal(freeformCanvas({...open, [k]: true}, nobody, plain), 'hidden', k)
  for (const k of ['gone', 'scheduled'] as const) assert.equal(freeformCanvas({...open, [k]: true}, nobody, plain), 'readOnly', k)
  assert.equal(freeformCanvas({...open, canWrite: false}, nobody, plain), 'readOnly')
})

// task-f37f60d972f6f5ab: "Edit the body in Freeform" opens the canvas, which writes the type's body
// region. A body read-only for this person (fieldState: the schema's or a form.conditions readOnly,
// #1288) leaves the canvas read-only, so it cannot be changed there.
test('form lock: the Freeform canvas is read-only while its body region is read-only for this person', () => {
  const article = (body: Record<string, unknown> = {}) =>
    ({name: 'article', title: 'Article', layout: [{kind: 'field', name: 'title'}, {kind: 'region', name: 'body'}], fields: [{name: 'title', type: 'string'}, {name: 'stage', type: 'string'}, {name: 'body', type: 'richText', ...body}]}) as unknown as Schema
  const doc = {title: 'T', stage: 'draft', body: {blocks: []}}
  const editor = currentUserOf({email: 'e@example.com', name: 'E', userId: 'u1', role: 'member', canWrite: true})
  const admin = currentUserOf({email: 'a@example.com', name: 'A', userId: 'u2', role: 'admin', canWrite: true})
  const canvas = (schema: Schema, user = editor, rules?: Record<string, FieldConditions>, d: Record<string, unknown> = doc) => freeformCanvas(open, user, {schema, doc: d, rules})
  assert.equal(canvas(article()), 'editable')
  // The schema's readOnly, always or on a condition (Barkpark's shape).
  assert.equal(canvas(article({readOnly: true})), 'readOnly')
  const whenDone = article({readOnly: {field: 'stage', operator: 'eq', value: 'done'}})
  assert.equal(canvas(whenDone, editor, undefined, {...doc, stage: 'done'}), 'readOnly')
  assert.equal(canvas(whenDone), 'editable')
  // A role condition (form.conditions): read-only for an editor, open for an administrator.
  const adminsOnly: Record<string, FieldConditions> = {'article.body': {readOnly: ({currentUser}) => !!currentUser && !currentUser.roles.some((r) => r.name === 'administrator')}}
  assert.equal(canvas(article(), editor, adminsOnly), 'readOnly')
  assert.equal(canvas(article(), admin, adminsOnly), 'editable')
  // Only the body region: another read-only field leaves the canvas as it is, and a lock on the form still wins.
  assert.equal(canvas(article(), editor, {'article.stage': {readOnly: true}}), 'editable')
  assert.equal(freeformCanvas({...open, canWrite: false}, admin, {schema: article(), doc, rules: adminsOnly}), 'readOnly')
  assert.equal(freeformCanvas({...open, published: true}, editor, {schema: article({readOnly: true}), doc, rules: undefined}), 'hidden')
})
