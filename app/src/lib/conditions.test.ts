// J30 + barkpark#22554: a condition reads the document, or (scope "parent") its object.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fieldState, groupShows, isHidden, pasteSkips, type CurrentUser, type FieldConditions, type Person} from './conditions.ts'
import type {Field} from './data.ts'
import {roleConditions} from './conditions.fixture.ts'
import {known, mint, nobody, unknown} from './persons.fixture.ts'
import {pasteDocument} from './paste-locked.ts'

test('scope "parent" reads the enclosing object, the default reads the document', () => {
  const url = {name: 'url', type: 'url', visibleWhen: {field: 'kind', operator: 'eq', value: 'url', scope: 'parent'}} as unknown as Field
  const doc = {kind: 'internal', cta: {kind: 'url'}}
  assert.equal(isHidden(url, doc, doc.cta), false)
  assert.equal(isHidden(url, doc, {kind: 'internal'}), true)
  assert.equal(isHidden(url, doc), true) // no parent: the document's kind
  const top = {...url, visibleWhen: {field: 'kind', operator: 'eq', value: 'url'}} as unknown as Field
  assert.equal(isHidden(top, doc, doc.cta), true) // the default scope ignores the parent
})

test("a group shows while one of its fields does (Sanity's visibleGroups)", () => {
  const fields = [
    {name: 'featured', type: 'boolean', group: 'meta'},
    {name: 'promoLine', type: 'string', group: 'promo', visibleWhen: {field: 'featured', operator: 'eq', value: true}},
  ] as unknown as Field[]
  assert.equal(groupShows(fields, 'promo', {featured: false}), false)
  assert.equal(groupShows(fields, 'promo', {featured: true}), true)
  assert.equal(groupShows(fields, 'meta', {}), true)
})

// task-be96d37504cf4ed3: Sanity's hidden / readOnly callbacks with currentUser, from the studio config.
const me = (role: string | null, canWrite = true) => ({email: 'a@example.com', name: 'A', userId: 'u1', role, canWrite})
const isAdmin = ({currentUser}: {currentUser: {roles: {name: string}[]} | null}) => !!currentUser?.roles.some((r) => r.name === 'administrator')

test('readOnly ({currentUser}) locks the field for an editor and leaves it open for an administrator', () => {
  const stage = {name: 'stage', type: 'select'} as unknown as Field
  const rules = roleConditions
  const doc = {stage: 'draft'}
  assert.equal(fieldState('post', stage, doc, mint(me('member')), rules).readOnly, true)
  assert.equal(fieldState('post', stage, doc, mint(me('owner')), rules).readOnly, false)
  assert.equal(fieldState('post', stage, doc, mint(me('admin')), rules).readOnly, false)
  // A seat that may not write is Sanity's viewer; another type's field is not this rule's.
  assert.deepEqual((mint(me('member', false)) as CurrentUser).roles, [{name: 'viewer', title: 'Viewer'}])
  assert.equal(fieldState('author', stage, doc, mint(me('member')), rules).readOnly, false)
  // Nobody signed in (shared sign-in): currentUser is null, and this config leaves the field open.
  assert.equal(fieldState('post', stage, doc, nobody, rules).readOnly, false)
  assert.equal(mint({...me('owner'), email: null}), nobody)
  // Barkpark not answered yet (no answer, or the server render's provisional stand-in): not known, so the rule locks it (fieldrule.test.ts).
  assert.equal(mint({...me('owner'), provisional: true}), unknown)
  assert.equal(mint(undefined), unknown)
  assert.equal(fieldState('post', stage, doc, unknown, rules).readOnly, true)
})

test('a callback gets Sanity\'s context; one that throws, or answers anything but true, leaves the field open', () => {
  const title = {name: 'title', type: 'string'} as unknown as Field
  const doc = {links: [{_key: 'l1', title: 'x'}]}
  let seen: unknown
  const rules: Record<string, FieldConditions> = {'post.links.title': {hidden: (c) => ((seen = c), true)}}
  const user = mint(me('member'))
  assert.equal(fieldState('post', title, doc, user, rules, {path: 'links[_key=="l1"].title', value: 'x', parent: doc.links[0]}).hidden, true)
  assert.deepEqual(seen, {currentUser: user, document: doc, parent: doc.links[0], value: 'x', path: ['links', {_key: 'l1'}, 'title']})
  const errors: unknown[] = []
  const was = console.error
  console.error = (m: unknown) => void errors.push(m)
  try {
    // Sanity's own example on a shared studio: currentUser is null, so it throws.
    const sanityStyle = {hidden: ({currentUser}: {currentUser: {roles: {name: string}[]} | null}) => !currentUser!.roles.some((r) => r.name === 'administrator')}
    assert.equal(fieldState('post', title, {}, nobody, {'post.title': sanityStyle}).hidden, false)
    assert.equal(fieldState('post', title, {}, nobody, {'post.title': sanityStyle}).hidden, false)
    assert.equal(errors.length, 1) // said once, not on every keystroke
    assert.equal(fieldState('post', title, {}, user, {'post.title': {readOnly: () => 1 as unknown as boolean}}).readOnly, false)
    assert.equal(fieldState('post', title, {}, user, {'post.title': {readOnly: (() => Promise.resolve(true)) as unknown as () => boolean}}).readOnly, false)
  } finally {
    console.error = was
  }
})

test('hidden by role: its group tab goes when nothing in it shows, and Paste document never writes it', () => {
  const fields = [
    {name: 'title', type: 'string', group: 'content'},
    {name: 'internal', type: 'text', group: 'admin'},
    {name: 'stage', type: 'select', title: 'Stage', group: 'content'},
  ] as unknown as Field[]
  const rules: Record<string, FieldConditions> = {'post.internal': {hidden: (c) => !isAdmin(c)}, 'post.stage': {readOnly: (c) => !isAdmin(c)}}
  const doc = {title: 'T', internal: 'kept', stage: 'review'}
  const editor = mint(me('member'))
  const hiddenFor = (u: typeof editor) => (f: Field) => fieldState('post', f, doc, u, rules).hidden
  assert.equal(groupShows(fields, 'admin', doc, hiddenFor(editor)), false)
  assert.equal(groupShows(fields, 'admin', doc, hiddenFor(mint(me('admin')))), true)
  // Paste document: the read-only field is skipped and named, the hidden one never named.
  const editorPaste = pasteDocument(fields, {title: 'P', internal: 'pasted', stage: 'idea'}, {type: 'post', doc, user: editor, rules})
  assert.deepEqual(editorPaste.writes, [['title', 'P']])
  assert.deepEqual(editorPaste.named, ['Stage'])
  assert.deepEqual([...pasteSkips('post', fields, doc, editor, rules).skip], ['internal', 'stage'])
  assert.equal(pasteDocument(fields, {title: 'P', internal: 'pasted', stage: 'idea'}, {type: 'post', doc, user: mint(me('owner')), rules}).writes.length, 3)
})

test('the test people (persons.fixture.ts) are as a role rule sees them: currentUser with the role, null, and unknown', () => {
  const seen: unknown[] = []
  const f = {name: 'title', type: 'string'} as Field
  for (const p of [known('editor'), nobody, unknown] as Person[]) fieldState('post', f, {}, p, {'post.title': {hidden: ({currentUser}) => (seen.push(currentUser), false)}})
  assert.deepEqual(seen, [{id: 'u1', name: 'A', email: 'a@example.com', roles: [{name: 'editor', title: 'Editor'}]}, null])
})
