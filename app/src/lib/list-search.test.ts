// task-c5198a445f6dfc62: a multi-word list search asked Barkpark once per word for a count
// (limit 1), waited, then searched the rarest word again: N+1 calls in two rounds. Now one
// call per distinct word, at the list's size, in one capped round; the same documents.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {listSearch, SEARCH_CONCURRENCY, type Search} from './list-search.ts'

// A fake Barkpark: `hits` is each word's matches, newest first. Records every call and how
// many were in flight at once; answers on the next tick so a round can overlap.
function fake(hits: Record<string, string[]>) {
  const calls: {q: string; limit: number}[] = []
  let inFlight = 0
  let maxInFlight = 0
  const search: Search<string> = async (q, limit) => {
    calls.push({q, limit})
    maxInFlight = Math.max(maxInFlight, ++inFlight)
    await new Promise((r) => setTimeout(r, 1))
    inFlight--
    const all = hits[q] ?? []
    return {documents: all.slice(0, limit), count: all.length}
  }
  return {search, calls, max: () => maxInFlight}
}

const hits = {
  fixture: ['p3', 'p2', 'p1', 'x9'],
  post: ['p3', 'p2', 'p1', 'q7', 'q8'],
  one: ['p1', 'z1'],
}

test('one call per word, all at the list size, and the rarest word’s documents', async () => {
  const f = fake(hits)
  assert.deepEqual(await listSearch('fixture post one', 100, f.search), ['p1', 'z1'])
  assert.deepEqual(f.calls, [
    {q: 'fixture', limit: 100},
    {q: 'post', limit: 100},
    {q: 'one', limit: 100},
  ])
  assert.equal(f.max(), 3, 'one round, not counts then a search')
})

test('a word twice is searched once; one word is one call', async () => {
  const f = fake(hits)
  assert.deepEqual(await listSearch('post  post', 100, f.search), hits.post)
  assert.equal(f.calls.length, 1)
  const g = fake(hits)
  assert.deepEqual(await listSearch('fixture', 2, g.search), ['p3', 'p2'])
  assert.deepEqual(g.calls, [{q: 'fixture', limit: 2}])
})

test('a tie keeps the first word, as before', async () => {
  const f = fake({a: ['d1', 'd2'], b: ['d2', 'd1']})
  assert.deepEqual(await listSearch('a b', 100, f.search), ['d1', 'd2'])
  const g = fake({a: ['d1', 'd2'], b: ['d2', 'd1']})
  assert.deepEqual(await listSearch('b a', 100, g.search), ['d2', 'd1'])
})

test('many words: at most SEARCH_CONCURRENCY searches at once, every word still asked', async () => {
  const words = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']
  const f = fake(Object.fromEntries(words.map((w, i) => [w, Array.from({length: 10 - i}, (_, k) => `${w}-${k}`)])))
  assert.deepEqual(await listSearch(words.join(' '), 100, f.search), Array.from({length: 4}, (_, k) => `w7-${k}`))
  assert.equal(f.calls.length, words.length)
  assert.ok(f.max() <= SEARCH_CONCURRENCY, `${f.max()} in flight`)
})

test('an empty query is one search for nothing, as before', async () => {
  const f = fake(hits)
  assert.deepEqual(await listSearch('  ', 100, f.search), [])
  assert.deepEqual(f.calls, [{q: '', limit: 100}])
})
