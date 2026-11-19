// task-27d3f08bf49a2259: a paste keeps a field a role rule hides from the person and shows to any
// role the workspace defines, custom ones too; when Barkpark does not say which, today's roles.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Field} from './data.ts'
import type {FieldConditions} from './conditions.ts'
import {known} from './persons.fixture.ts'
import {keepLocked, pasteDocument, pasteDocumentReading, pasteFieldReading} from './paste-locked.ts'
import {readWorkspaceRoles, ROLES_PATH, rolesFor} from './workspace-roles.ts'

const editor = known('editor', {name: 'E', email: 'e@example.com'})
const fields = [{name: 'title', type: 'string'}, {name: 'review', type: 'string'}] as unknown as Field[]
const onlyFor = (role: string): FieldConditions => ({hidden: ({currentUser}) => !currentUser?.roles.some((r) => r.name === role)})
/** Barkpark's answer for a workspace with a custom `reviewer` role. */
const ROUTE = {roles: ['owner', 'admin', 'member', 'contributor', 'reviewer']}
const answer = (status: number, body: unknown) => async (path: string) => {
  assert.equal(path, ROLES_PATH)
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
}

test('a field shown only to a custom role the person lacks is kept by their paste', async () => {
  const roles = await readWorkspaceRoles(answer(200, ROUTE))
  assert.deepEqual(roles, ROUTE.roles)
  const rules = {'post.review': onlyFor('reviewer')}
  const doc = {title: 'A', review: 'kept'}
  const paste = pasteDocument(fields, {title: 'B', review: 'pasted'}, {type: 'post', doc, user: editor, rules, roles: roles!})
  assert.deepEqual(paste, {writes: [['title', 'B']], named: []}, 'kept, unnamed, as any role-hidden field')
  // At depth too (Paste field).
  const box = {name: 'box', type: 'composite', fields} as unknown as Field
  const inBox = {'post.box.review': onlyFor('reviewer')}
  assert.deepEqual(keepLocked(box, 'box', {title: 'B', review: 'pasted'}, {title: 'A', review: 'kept'}, {type: 'post', doc: {box: doc}, user: editor, rules: inBox, roles: roles!}), {title: 'B', review: 'kept'})
  // A reviewer sees it, so their paste writes it.
  const reviewer = known('reviewer', {name: 'E', email: 'e@example.com'})
  assert.deepEqual(pasteDocument(fields, {title: 'B', review: 'pasted'}, {type: 'post', doc, user: reviewer, rules, roles: roles!}).writes, [['title', 'B'], ['review', 'pasted']])
  // Barkpark's names are asked under Sanity's (sanityRole): its `member` is `editor`, so no role named
  // `member` sees a field a rule shows only to that name, and the paste writes it.
  assert.deepEqual(pasteDocument(fields, {review: 'pasted'}, {type: 'post', doc, user: editor, rules: {'post.review': onlyFor('member')}, roles: ROUTE.roles}).writes, [['review', 'pasted']])
})

test("no roles from Barkpark: today's roles, never no lock", async () => {
  // No such route (an older server), a refusal (no seat; a token bound to another dataset), a
  // failed read, a body not in the route's shape: none says which roles there are.
  for (const get of [
    answer(404, {error: 'not_found'}),
    answer(403, {error: {code: 'forbidden', reason: 'dataset_not_bound'}}),
    answer(403, {error: {code: 'not_a_member'}}),
    answer(500, ROUTE),
    answer(200, {roles: 'reviewer'}),
    answer(200, {roles: ['owner', 7]}),
    answer(200, null),
    async () => new Response('<html>', {status: 200}),
    async () => Promise.reject(new Error('offline')),
  ])
    assert.equal(await readWorkspaceRoles(get), null)
  const doc = {title: 'A', review: 'kept'}
  // A rule for a built-in role still locks: the editor's paste keeps a field shown only to administrators.
  assert.deepEqual(pasteDocument(fields, {title: 'B', review: 'pasted'}, {type: 'post', doc, user: editor, rules: {'post.review': onlyFor('administrator')}}).writes, [['title', 'B']])
  // A custom role is not known then: as before, a field no known role sees is visibility from the data.
  assert.deepEqual(pasteDocument(fields, {title: 'B', review: 'pasted'}, {type: 'post', doc, user: editor, rules: {'post.review': onlyFor('reviewer')}}).writes, [['title', 'B'], ['review', 'pasted']])
})

test("the roles are read with the signed-in person's own token, and every paste asks them", async () => {
  // session.ts's read: the person's token reaches Barkpark, and no one signed in reads nothing.
  const tokens: string[] = []
  const fetch = async (path: string, _init: RequestInit, token: string) => (tokens.push(token), answer(200, ROUTE)(path))
  assert.deepEqual(await rolesFor({token: 'person-token'}, fetch), ROUTE.roles)
  assert.equal(await rolesFor(undefined, fetch), null)
  assert.deepEqual(tokens, ['person-token'])
  // Paste document and Paste field (DocHeaderMenu, Fields) read the roles, faked here as Barkpark's
  // answer with a custom `reviewer`: a field shown only to it is kept from the editor's paste.
  let asked = 0
  const reads = {schemas: async () => [], roles: async () => (asked++, readWorkspaceRoles(answer(200, ROUTE)))}
  const rules = {'post.review': onlyFor('reviewer')}
  const doc = {title: 'A', review: 'kept'}
  assert.deepEqual((await pasteDocumentReading(reads, fields, {title: 'B', review: 'pasted'}, editor, {type: 'post', doc, rules})).writes, [['title', 'B']])
  const box = {name: 'box', type: 'composite', fields} as unknown as Field
  const inBox = {'post.box.review': onlyFor('reviewer')}
  assert.deepEqual(await pasteFieldReading(reads, box, 'box', {title: 'B', review: 'pasted'}, doc, editor, {type: 'post', doc: {box: doc}, rules: inBox}), {value: {title: 'B', review: 'kept'}})
  assert.equal(asked, 2, 'each paste reads the roles')
  // A failed roles read: today's roles, so the custom role is unknown and the field is written, as before.
  const failing = {...reads, roles: () => Promise.reject(new Error('offline'))}
  assert.deepEqual((await pasteDocumentReading(failing, fields, {title: 'B', review: 'pasted'}, editor, {type: 'post', doc, rules})).writes, [['title', 'B'], ['review', 'pasted']])
})
