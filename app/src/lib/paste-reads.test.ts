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
