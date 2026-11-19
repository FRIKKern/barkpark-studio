// task-27d3f08bf49a2259: a paste keeps a field a role rule hides from the person and shows to any
// role the workspace defines, custom ones too; when Barkpark does not say which, today's roles.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import type {Field} from './data.ts'
import type {FieldConditions} from './conditions.ts'
import {keepLocked, pasteDocument} from './paste-locked.ts'
import {readWorkspaceRoles, ROLES_PATH} from './workspace-roles.ts'

const editor = {id: 'u1', name: 'E', email: 'e@example.com', roles: [{name: 'editor', title: 'Editor'}]}
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
  const reviewer = {...editor, roles: [{name: 'reviewer', title: 'reviewer'}]}
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

test("the roles are read with the signed-in person's own token, never the studio's, and every paste asks them", () => {
  const session = readFileSync(new URL('./session.ts', import.meta.url), 'utf8')
  const read = session.slice(session.indexOf('const fetchWorkspaceRoles'), session.indexOf('export const workspaceRolesQuery'))
  assert.match(read, /const editor = currentEditor\(\)\n\s+return editor \? readWorkspaceRoles\(\(path\) => bpFetch\(path, \{\}, editor\.token\)\) : null/)
  assert.doesNotMatch(read, /serviceToken|studioToken|contentModelToken|requestToken/)
  for (const file of ['../components/DocHeaderMenu.tsx', '../components/Fields.tsx']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(src, /qc\.ensureQueryData\(workspaceRolesQuery\)\.catch\(\(\) => null\)/, file)
    assert.match(src, /rules: studio\.form\?\.conditions, roles: roles \?\? undefined, schemas\}/, file)
  }
})
