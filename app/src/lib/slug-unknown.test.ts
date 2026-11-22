// task-eee5e04cf67a1b23: a slug check Barkpark cannot answer (the query refused) is "can't tell",
// never "free". The footer's Publish (publish()) and «Publish selected» (runBulk with
// slugsTakenAmong) both hold the draft and say the slug could not be checked; no publish is sent.
// A real "taken" and a real "free" answer go exactly as before (the first two tests pass on main).
// lib/edits.ts and lib/slug-unique.ts against a Barkpark kept in memory (save-flow.hooks.mjs).
import {test, after} from 'node:test'
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {QueryClient} from '@tanstack/react-query'
register('./save-flow.hooks.mjs', import.meta.url)
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})

/** How Barkpark answers a slug query now: 'ok' (a document elsewhere holds «opptatt»), or a refusal. */
let slugQuery: 'ok' | 503 = 'ok'
/** The ids a publish was sent for. */
const published: string[] = []
;(globalThis as Record<string, unknown>).saveFlowServer = {
  read: async () => null,
  fetch: async (_page: string, url: string, init: {body?: string}) => {
    if (url.startsWith('/v1/data/query/')) {
      if (slugQuery !== 'ok') return {ok: false, status: slugQuery, json: async () => ({error: {code: 'unavailable', message: 'Service Unavailable'}})}
      const documents = decodeURIComponent(url).includes('opptatt') ? [{_id: 'drafts.annen', _publishedId: 'annen', _type: 'side', lenke: {current: 'opptatt'}}] : []
      return {ok: true, status: 200, json: async () => ({result: {documents}})}
    }
    const m = (JSON.parse(init.body!).mutations as {publish?: {id: string}}[]).at(-1)!
    const id = m.publish!.id
    published.push(id)
    const document = {_id: id, _publishedId: id, _type: 'side', _rev: 'p1', _draft: false, _hasPublished: true}
    return {ok: true, status: 200, json: async () => ({transactionId: 'p1', results: [{id, operation: 'publish', document}]})}
  },
}
const E = await import('./edits.ts')
E.setKeepScope('s')
after(() => E.forgetEdits())
const {slugsTakenAmong} = await import('./slug-unique.ts')
const {runBulk} = await import('./bulk-publish.ts')

const schema = {name: 'side', title: 'Side', fields: [{name: 'tittel', title: 'Tittel', type: 'string'}, {name: 'lenke', title: 'Lenke', type: 'slug'}]}
const draft = (id: string, slug: string) => ({_id: `drafts.${id}`, _publishedId: id, _type: 'side', _rev: 'r1', _draft: true, _hasPublished: false, tittel: id, lenke: {current: slug}})
type Draft = ReturnType<typeof draft>
const client = (docs: Draft[]) => {
  const qc = new QueryClient()
  qc.setQueryData(['schemas'], [schema])
  for (const d of docs) qc.setQueryData(['doc', d._publishedId], d)
  return qc
}
/** The footer's Publish: what publish() did ("published", or its refusal's words). */
async function footer(d: Draft) {
  published.length = 0
  const said = await E.publish(client([d]), d as never).then(() => 'published', (e: Error) => e.message)
  return {said, published: [...published]}
}
/** «Publish selected» on these drafts, as BulkBar wires it (the whole draft read, the slugs asked once). */
async function bulk(docs: Draft[]) {
  published.length = 0
  const qc = client(docs)
  const judge = {
    conditions: undefined,
    schemaFor: () => schema,
    rulesFor: () => [],
    nameOf: (d: Draft) => d.tittel,
    readDoc: async (_type: string, id: string) => qc.getQueryData(['doc', id]),
    readRef: async () => null,
    slugsAmong: (ds: Draft[]) => slugsTakenAmong(qc, ds as never, () => schema as never),
  }
  const outcomes = await runBulk(qc, 'publish', docs as never, {} as never, {judge: judge as never, at: () => {}, t: (s) => s})
  return {outcomes, published: [...published]}
}

test('a slug Barkpark says is free publishes, and one it says is taken is refused in the same words (as on main): footer and Publish selected', async () => {
  slugQuery = 'ok'
  assert.deepEqual(await footer(draft('fri', 'ledig')), {said: 'published', published: ['fri']})
  assert.deepEqual(await footer(draft('tatt', 'opptatt')), {said: 'Lenke: Slug is already in use', published: []})
  assert.deepEqual(await bulk([draft('fri', 'ledig'), draft('tatt', 'opptatt')]), {outcomes: [{kind: 'done'}, {kind: 'failed', reason: 'Lenke: Slug is already in use'}], published: ['fri']})
})

test('a slug query Barkpark refuses holds the publish and says the slug could not be checked: no publish is sent (footer and Publish selected)', async () => {
  slugQuery = 503
  try {
    assert.deepEqual(await footer(draft('ukjent', 'ledig')), {said: 'Lenke: Slug could not be checked. Try again.', published: []})
    // The one ask for all is refused, so each publish asks its own (the footer's), refused as well.
    assert.deepEqual(await bulk([draft('a', 'ledig'), draft('b', 'opptatt')]), {
      outcomes: [
        {kind: 'failed', reason: 'Lenke: Slug could not be checked. Try again.'},
        {kind: 'failed', reason: 'Lenke: Slug could not be checked. Try again.'},
      ],
      published: [],
    })
  } finally {
    slugQuery = 'ok'
  }
})
