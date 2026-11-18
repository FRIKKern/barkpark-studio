// J30 + barkpark#22554: a condition reads the document, or (scope "parent") its object.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Field} from './data.ts'
import {currentUserOf, fieldState, groupShows, isHidden, pasteSkips, type FieldConditions} from './conditions.ts'

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
  const rules: Record<string, FieldConditions> = {'post.stage': {readOnly: (c) => !isAdmin(c)}}
  const doc = {stage: 'draft'}
  assert.equal(fieldState('post', stage, doc, currentUserOf(me('member')), rules).readOnly, true)
  assert.equal(fieldState('post', stage, doc, currentUserOf(me('owner')), rules).readOnly, false)
  assert.equal(fieldState('post', stage, doc, currentUserOf(me('admin')), rules).readOnly, false)
  // A seat that may not write is Sanity's viewer; another type's field is not this rule's.
  assert.deepEqual(currentUserOf(me('member', false))?.roles, [{name: 'viewer', title: 'Viewer'}])
  assert.equal(fieldState('author', stage, doc, currentUserOf(me('member')), rules).readOnly, false)
  // Nobody signed in (shared sign-in) or Barkpark not answered yet: currentUser is null.
  assert.equal(currentUserOf({...me('owner'), email: null}), null)
  assert.equal(currentUserOf({...me('owner'), provisional: true}), null)
})

test('a callback gets Sanity\'s context; one that throws, or answers anything but true, leaves the field open', () => {
  const title = {name: 'title', type: 'string'} as unknown as Field
  const doc = {links: [{_key: 'l1', title: 'x'}]}
  let seen: unknown
  const rules: Record<string, FieldConditions> = {'post.links.title': {hidden: (c) => ((seen = c), true)}}
  const user = currentUserOf(me('member'))
  assert.equal(fieldState('post', title, doc, user, rules, {path: 'links[_key=="l1"].title', value: 'x', parent: doc.links[0]}).hidden, true)
  assert.deepEqual(seen, {currentUser: user, document: doc, parent: doc.links[0], value: 'x', path: ['links', {_key: 'l1'}, 'title']})
  const errors: unknown[] = []
  const was = console.error
  console.error = (m: unknown) => void errors.push(m)
  try {
    // Sanity's own example on a shared studio: currentUser is null, so it throws.
    const sanityStyle = {hidden: ({currentUser}: {currentUser: {roles: {name: string}[]} | null}) => !currentUser!.roles.some((r) => r.name === 'administrator')}
    assert.equal(fieldState('post', title, {}, null, {'post.title': sanityStyle}).hidden, false)
    assert.equal(fieldState('post', title, {}, null, {'post.title': sanityStyle}).hidden, false)
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
  const editor = currentUserOf(me('member'))
  const hiddenFor = (u: typeof editor) => (f: Field) => fieldState('post', f, doc, u, rules).hidden
  assert.equal(groupShows(fields, 'admin', doc, hiddenFor(editor)), false)
  assert.equal(groupShows(fields, 'admin', doc, hiddenFor(currentUserOf(me('admin')))), true)
  const editorPaste = pasteSkips('post', fields, doc, editor, rules)
  assert.deepEqual([...editorPaste.skip], ['internal', 'stage'])
  assert.deepEqual(editorPaste.named, ['Stage']) // the hidden one is never named
  assert.equal(pasteSkips('post', fields, doc, currentUserOf(me('owner')), rules).skip.size, 0)
})
