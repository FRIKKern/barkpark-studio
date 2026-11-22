// task-bc49c598e05b1fbf: Publish selected judges a draft on Barkpark's answer now. The studio
// server shares an identical read for 0.5 s (server/barkpark.ts bpFetch); a fresh read skips
// that, so an edit made in that half second is seen. lib/data.ts's document read runs as it is
// (doc-read.hooks.mjs), with that shared layer played here.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {register} from 'node:module'
import {test} from 'node:test'
import {QueryClient} from '@tanstack/react-query'

register('./doc-read.hooks.mjs', import.meta.url)

type Draft = {_id: string; _publishedId: string; _type: string; _rev: string; _draft: true}
let current: Draft = {_id: 'drafts.p1', _publishedId: 'p1', _type: 'post', _rev: 'r1', _draft: true}
/** The studio server's shared reads: a GET answered once is answered the same until it lapses (here: never). */
const shared = new Map<string, unknown>()
;(globalThis as Record<string, unknown>).docRead = {
  fetch: async (path: string, _init?: RequestInit, _token?: string, {fresh = false}: {fresh?: boolean} = {}) => {
    const body = path.includes('perspective=published') ? {result: {documents: []}} : {result: current}
    if (fresh) return Response.json(body)
    if (!shared.has(path)) shared.set(path, structuredClone(body))
    return Response.json(shared.get(path))
  },
}
const {docQuery} = await import('./data.ts')

test('Publish selected reads a draft fresh: the read the studio server shares for half a second never stands in for it', async () => {
  const qc = new QueryClient()
  const read = (fresh: boolean) => qc.fetchQuery({...docQuery('post', 'p1', fresh ? {fresh} : {}), staleTime: 0})
  // A pane read it a moment ago; then someone else saves it.
  assert.equal((await read(false))?._rev, 'r1')
  current = {...current, _rev: 'r2'}
  assert.equal((await read(false))?._rev, 'r1', 'a shared read answers the revision from before the edit')
  assert.equal((await read(true))?._rev, 'r2')
  // Publish selected's draft reads are the fresh ones.
  const bar = readFileSync(new URL('../components/BulkBar.tsx', import.meta.url), 'utf8')
  assert.match(bar, /readDoc: \(type, id\) => qc\.fetchQuery\(\{\.\.\.docQuery\(type, id, \{fresh: true\}\), staleTime: 0\}\),/)
})
