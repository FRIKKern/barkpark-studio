import {test} from 'node:test'
import assert from 'node:assert/strict'
import {asText, authorsByField, changedFields, sinceLastPublish, textDiff} from './changes.ts'

const rev = (id: string, action: string, author: string) => ({id, action, author, status: 'draft' as const, timestamp: ''})

test('changedFields lists only fields whose draft differs from published', () => {
  const schema = {name: 'post', title: 'Post', fields: [{name: 'title', type: 'string'}, {name: 'rating', type: 'number'}, {name: 'seo', type: 'composite'}]}
  const out = changedFields(schema, {title: 'A', rating: 1, seo: {x: 1}}, {title: 'B', rating: 1, seo: {x: 1}})
  assert.deepEqual(out.map((c) => c.field.name), ['title'])
})
test('authorsByField credits each change to the snapshot that made it', () => {
  const snaps: [ReturnType<typeof rev>, Record<string, unknown>][] = [
    [rev('3', 'update', 'b@x'), {title: 'C', excerpt: 'E2'}],
    [rev('2', 'update', 'a@x'), {title: 'B', excerpt: 'E2'}],
    [rev('1', 'create', 'a@x'), {title: 'B', excerpt: 'E1'}],
    [rev('0', 'publish', 'a@x'), {title: 'A', excerpt: 'E1'}],
  ]
  const m = authorsByField(snaps)
  assert.deepEqual(m.get('title'), ['b@x', 'a@x'])
  assert.deepEqual(m.get('excerpt'), ['a@x'])
})
test('sinceLastPublish stops at the newest publish', () => {
  const {draft, publish} = sinceLastPublish([rev('3', 'update', 'a'), rev('2', 'create', 'a'), rev('1', 'publish', 'a'), rev('0', 'create', 'a')])
  assert.deepEqual(draft.map((r) => r.id), ['3', '2'])
  assert.equal(publish?.id, '1')
})
test('textDiff and asText', () => {
  assert.deepEqual(textDiff('Fixture post 24', 'History fixture v7').map((s) => s.kind).includes('removed'), true)
  assert.equal(asText({blocks: [{content: [{type: 'text', value: 'Hi'}]}, {text: 'Head'}]}), 'Hi\nHead')
  assert.equal(asText({x: 1}), undefined)
})
