import {test} from 'node:test'
import assert from 'node:assert/strict'
import {addQuery, deleteQuery, findSaved, readQueries, renameQuery, searchQueries, updateQuery, type SavedQuery} from './vision-queries.ts'

const q = (key: string, title: string, query = 'post?limit=5'): SavedQuery => ({key, title, query, perspective: 'drafts', dataset: 'ci', savedAt: '2026-10-10T20:00:00Z'})

test('saved queries: read, add, find, rename, search, delete', () => {
  assert.deepEqual(readQueries(null), [])
  assert.deepEqual(readQueries({queries: [q('a', 'A'), {junk: 1}]}).map((s) => s.key), ['a'])
  let list = addQuery([q('a', 'Untitled')], q('b', 'Untitled', 'author'))
  assert.deepEqual(list.map((s) => s.key), ['b', 'a'])
  // The same query, perspective and dataset is already saved; another dataset is not.
  assert.equal(findSaved(list, {query: ' post?limit=5 ', perspective: 'drafts', dataset: 'ci'})?.key, 'a')
  assert.equal(findSaved(list, {query: 'post?limit=5', perspective: 'drafts', dataset: 'ci-2'}), undefined)
  list = renameQuery(list, 'a', ' Latest posts ')
  assert.equal(list[1]!.title, 'Latest posts')
  assert.equal(renameQuery(list, 'a', '  ')[1]!.title, 'Latest posts')
  assert.deepEqual(searchQueries(list, 'latest').map((s) => s.key), ['a'])
  // Update: the query being edited replaces the saved one's, its title stays.
  const updated = updateQuery(list, 'a', {query: 'post?limit=9', perspective: 'published', dataset: 'ci'}, '2026-10-16T12:00:00Z')[1]!
  assert.deepEqual([updated.title, updated.query, updated.perspective, updated.savedAt], ['Latest posts', 'post?limit=9', 'published', '2026-10-16T12:00:00Z'])
  assert.deepEqual(deleteQuery(list, 'a').map((s) => s.key), ['b'])
})
