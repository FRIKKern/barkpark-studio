import {test} from 'node:test'
import assert from 'node:assert/strict'
import {allPages} from './pages.ts'

test('history: every page is read, down to the oldest (task-2502560b41be3217)', async () => {
  const rows = Array.from({length: 450}, (_, i) => i)
  const asked: number[] = []
  const got = await allPages(async (offset) => (asked.push(offset), {items: rows.slice(offset, offset + 200), next: offset + 200 < rows.length ? offset + 200 : null}))
  assert.equal(got.length, 450)
  assert.deepEqual(asked, [0, 200, 400])
  assert.equal((await allPages(async () => ({items: [1], next: 0}), 3)).length, 3) // a server that never ends stops at the cap
})
