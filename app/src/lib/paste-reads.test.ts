// task-fcedb95f343c738b: Paste document and Paste field read the workspace's roles themselves, from
// Barkpark with the signed-in person's own session: no menu hands in a read of its own (one that
// skips Barkpark), and no other session's roles are asked. Driven as the menus call them.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {test} from 'node:test'
import {QueryClient} from '@tanstack/react-query'
import type {Field} from './data.ts'
import type {FieldConditions} from './conditions.ts'

register('./paste-reads.hooks.mjs', import.meta.url)
const {pasteDocumentWith, pasteFieldWith} = await import('./paste-reads.ts')

const editor = {id: 'u1', name: 'E', email: 'e@example.com', roles: [{name: 'editor', title: 'Editor'}]}
const fields = [{name: 'title', type: 'string'}, {name: 'review', type: 'string'}] as unknown as Field[]
const onlyFor = (role: string): FieldConditions => ({hidden: ({currentUser}) => !currentUser?.roles.some((r) => r.name === role)})
const doc = {title: 'A', review: 'kept'}

test('the paste menus read the roles from Barkpark, with the signed-in person’s session', async () => {
  // Barkpark knows a custom `reviewer` role; the session signed in is this person's.
  const asked: {path: string; token: string}[] = []
  ;(globalThis as {pasteReads?: unknown}).pasteReads = {
    editor: {email: 'e@example.com', token: 'person-token'},
    fetch: async (path: string, _init: unknown, token: string) => {
      asked.push({path, token})
      return new Response(JSON.stringify({roles: ['owner', 'admin', 'member', 'contributor', 'reviewer']}), {status: 200})
    },
  }
  const qc = new QueryClient()
  // Paste document: the field shown only to reviewers is kept from the editor's paste.
  const paste = await pasteDocumentWith(qc, fields, {title: 'B', review: 'pasted'}, {type: 'post', doc, user: editor, rules: {'post.review': onlyFor('reviewer')}})
  assert.deepEqual(paste.writes, [['title', 'B']])
  // Paste field, at depth: the same.
  const box = {name: 'box', type: 'composite', fields} as unknown as Field
  const out = await pasteFieldWith(qc, box, 'box', {title: 'B', review: 'pasted'}, doc, {type: 'post', doc: {box: doc}, user: editor, rules: {'post.box.review': onlyFor('reviewer')}})
  assert.deepEqual(out, {value: {title: 'B', review: 'kept'}})
  // Asked of Barkpark once (a page load's), with this person's token.
  assert.deepEqual(asked, [{path: '/v1/workspace/roles', token: 'person-token'}])
})

test('a field locked for the person’s own custom role is kept, whichever way the roles read fails', async () => {
  // The person's role comes from who-am-I (their user), not from the workspace's role list.
  const reviewer = {...editor, roles: [{name: 'reviewer', title: 'reviewer'}]}
  const isReviewer = ({currentUser}: {currentUser: {roles: {name: string}[]} | null}) => !!currentUser?.roles.some((r) => r.name === 'reviewer')
  const answer = (status: number, body: string) => async () => new Response(body, {status, headers: {'content-type': 'application/json'}})
  const fails: [string, (...a: unknown[]) => Promise<Response>][] = [
    ['404', answer(404, '{"error":"not_found"}')],
    ['403 dataset_not_bound', answer(403, '{"error":{"code":"forbidden","reason":"dataset_not_bound"}}')],
    ['403 not_a_member', answer(403, '{"error":{"code":"not_a_member"}}')],
    ['429', answer(429, '{"error":"rate_limited"}')],
    ['500', answer(500, '{"roles":["reviewer"]}')],
    ['502', answer(502, '')],
    ['503', answer(503, '{"error":"unavailable"}')],
    ['roles not a list', answer(200, '{"roles":"reviewer"}')],
    ['a role not a name', answer(200, '{"roles":["owner",7]}')],
    ['roles empty', answer(200, '{"roles":[]}')],
    ['body null', answer(200, 'null')],
    ['not JSON', answer(200, '<html>')],
    ['fetch throws', () => {
      throw new Error('offline')
    }],
    ['fetch rejects', () => Promise.reject(new Error('reset'))],
  ]
  assert.equal(fails.length, 14)
  for (const [way, fetch] of fails)
    for (const [kind, rule] of [['readOnly', {readOnly: isReviewer}], ['hidden', {hidden: isReviewer}]] as const) {
      ;(globalThis as {pasteReads?: unknown}).pasteReads = {editor: {email: 'r@example.com', token: 'person-token'}, fetch}
      const qc = new QueryClient()
      const paste = await pasteDocumentWith(qc, fields, {title: 'B', review: 'pasted'}, {type: 'post', doc, user: reviewer, rules: {'post.review': rule}})
      assert.deepEqual(paste.writes, [['title', 'B']], `Paste document, ${kind} for reviewers, roles read ${way}`)
      const box = {name: 'box', type: 'composite', fields} as unknown as Field
      const out = await pasteFieldWith(qc, box, 'box', {title: 'B', review: 'pasted'}, doc, {type: 'post', doc: {box: doc}, user: reviewer, rules: {'post.box.review': rule}})
      assert.deepEqual(out, {value: {title: 'B', review: 'kept'}}, `Paste field, ${kind} for reviewers, roles read ${way}`)
    }
})
