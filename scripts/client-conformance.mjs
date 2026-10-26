#!/usr/bin/env node
// Client-level conformance (task-669ec9dd089119db): the calls a site makes through
// @sanity/client and @sanity/image-url, run read-only against the reference Sanity dataset
// and Barkpark's, each checked for the same behaviour. The scoreboard for the client
// drop-in work (live events, result source maps, image refs). Local only, not CI.
//
//   node --env-file=.env scripts/client-conformance.mjs           # the table
//   node --env-file=.env scripts/client-conformance.mjs --detail  # and each check's two answers
//   node --env-file=.env scripts/client-conformance.mjs --write-probes  # also the checks that write (e2e-local only)
//
// Reads BARKPARK_URL, BARKPARK_WORKSPACE, BARKPARK_PROJECT, BARKPARK_TOKEN and SANITY_TOKEN;
// the dataset is GROQ_DATASET (default e2e-local), never BARKPARK_DATASET. No writes: the
// client is only ever asked to read, listen or build a URL. The packages come from the
// reference studio's install (reference/sanity: pnpm install there first). The checks that need
// a write (writeProbe) run only with --write-probes, on e2e-local only: each makes one scratch
// post (zz-listen-…) and deletes it in the same check, then checks it is gone.

import {createRequire} from 'node:module'
import {fileURLToPath, pathToFileURL} from 'node:url'

const reference = createRequire(fileURLToPath(new URL('../reference/sanity/package.json', import.meta.url)))
const fromSanity = createRequire(reference.resolve('sanity/package.json'))
const load = (spec) => import(pathToFileURL(fromSanity.resolve(spec)).href)
const {createClient} = await load('@sanity/client')
const {stegaClean} = await load('@sanity/client/stega')
const {createImageUrlBuilder} = await load('@sanity/image-url')

const DATASET = process.env.GROQ_DATASET || 'e2e-local'
const API = '2025-02-19'
const detail = process.argv.includes('--detail')
const writeProbes = process.argv.includes('--write-probes')
if (writeProbes && DATASET !== 'e2e-local') (console.error('--write-probes writes scratch documents: e2e-local only'), process.exit(2))
const need = (k) => process.env[k] || (console.error(`missing env ${k}`), process.exit(2))
const bpHost = `${need('BARKPARK_URL')}/w/${need('BARKPARK_WORKSPACE')}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const sides = {
  sanity: {client: createClient({projectId: 'ecu57yeh', dataset: DATASET, apiVersion: API, token: need('SANITY_TOKEN'), useCdn: false}), project: 'ecu57yeh', imageBase: undefined},
  barkpark: {client: createClient({projectId: 'ecu57yeh', dataset: DATASET, apiVersion: API, token: need('BARKPARK_TOKEN'), useCdn: false, apiHost: bpHost, useProjectHostname: false}), project: 'ecu57yeh', imageBase: bpHost},
}

// A probe's own write: Sanity's through the client; Barkpark's through its /v1 mutate (the
// client's dated mutate path is the mutate-dry-run check, so the probe still measures listen).
const write = (c, side, mutations) =>
  side.imageBase
    ? fetch(`${side.imageBase}/v1/data/mutate/${DATASET}`, {method: 'POST', headers: {authorization: `Bearer ${c.config().token}`, 'content-type': 'application/json'}, body: JSON.stringify({mutations})}).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`mutate ${r.status}`))))
    : c.mutate(mutations)
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`no answer in ${ms / 1000} s`)), ms))])
const firstEvent = (observable, want, ms = 10_000) =>
  within(ms, new Promise((resolve, reject) => {
    const sub = observable.subscribe({next: (e) => (e.type === want ? (sub.unsubscribe(), resolve(e.type)) : undefined), error: (e) => reject(e)})
  }))
const errShape = (e) => ({statusCode: e?.statusCode ?? null, hasDescription: typeof (e?.response?.body?.error?.description ?? e?.details?.description) === 'string'})
const keysOf = (o) => Object.keys(o ?? {}).sort()

// Each check: what each side answers (a plain value), and how two answers count as the same.
// `known`: a difference filed as its own task, shown with it and still counted as not passing.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const CHECKS = [
  {id: 'fetch-basic', run: (c) => c.fetch('*[_id == "post-01"][0]{title, "author": author->name}')},
  {id: 'fetch-params', run: (c) => c.fetch('*[_type == "post" && slug.current == $slug][0]._id', {slug: 'fixture-post-07'})},
  {id: 'fetch-perspective-published', run: (c) => c.withConfig({perspective: 'published'}).fetch('count(*[_type == "author"])')},
  {id: 'fetch-perspective-drafts', run: (c) => c.withConfig({perspective: 'drafts'}).fetch('*[_id == "post-02"][0]._id')},
  {id: 'fetch-raw-response-keys', run: async (c) => keysOf(await c.fetch('*[_id == "post-01"][0]{title}', {}, {filterResponse: false})).filter((k) => k !== 'resultSourceMap')},
  {id: 'fetch-tag', run: (c) => c.fetch('count(*[_type == "category"])', {}, {tag: 'conformance'})},
  {id: 'getDocument', run: async (c) => { const d = await c.getDocument('post-01'); return d && {_id: d._id, _type: d._type, title: d.title} }},
  {id: 'getDocument-missing', run: async (c) => (await c.getDocument('no-such-doc-zz')) ?? null},
  {id: 'getDocuments', run: async (c) => (await c.getDocuments(['post-01', 'author-ada', 'no-such-doc-zz'])).map((d) => d?._id ?? null)},
  {id: 'listen-welcome', run: (c) => firstEvent(c.listen('*[_type == "post"]', {}, {events: ['welcome']}), 'welcome')},
  // Published events go out without the token (@sanity/client sends it only with includeDrafts),
  // as a site's defineLive does outside draft mode; drafts send it.
  {id: 'live-events-welcome', known: 'task-8239bb29f19b3511: the stream is token-or-member gated and the client sends no token without includeDrafts (owner decision)', run: (c) => firstEvent(c.live.events({includeDrafts: false}), 'welcome')},
  {id: 'live-events-drafts-welcome', run: (c) => firstEvent(c.live.events({includeDrafts: true}), 'welcome')},
  {
    // A listener filtered to authors hears nothing when a post is written (Sanity applies the
    // query to every mutation). One scratch post per side, deleted at once.
    id: 'listen-query-filter',
    writeProbe: true,
    known: 'task-72331698ada8a2f6: listen() does not apply its GROQ query filter yet',
    run: async (c, side) => {
      const heard = []
      const id = `zz-listen-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      let welcomed
      const ready = new Promise((r) => (welcomed = r))
      const sub = c.listen('*[_type == "author"]', {}, {events: ['welcome', 'mutation'], includeResult: false}).subscribe({next: (e) => (e.type === 'welcome' ? welcomed() : heard.push(e.documentId)), error: () => welcomed()})
      try {
        await within(10_000, ready)
        await write(c, side, [{createOrReplace: {_id: id, _type: 'post', title: 'Listen filter probe (deleted at once)'}}])
        await new Promise((r) => setTimeout(r, 3000))
      } finally {
        sub.unsubscribe()
        await write(c, side, [{delete: {id}}]).catch(() => {})
      }
      const gone = (await c.getDocument(id)) == null
      return {heardForAuthorFilter: heard.length, scratchGone: gone}
    },
  },
  // The client's own write path, without writing: a dry-run createOrReplace (Sanity validates and
  // writes nothing). Barkpark has no /v<date>/data/mutate yet.
  {id: 'mutate-dry-run', run: async (c) => { const r = await c.createOrReplace({_id: 'zz-dry-run-never-written', _type: 'post', title: 'dry run'}, {dryRun: true, returnDocuments: false}); return {ok: !!r?.transactionId || Array.isArray(r?.results)} }},
  {id: 'error-syntax', run: (c) => c.fetch('*[').then(() => 'no error', errShape)},
  {id: 'error-unauthorized', run: (c) => c.withConfig({token: 'not-a-token'}).fetch('count(*)').then(() => 'no error', (e) => e?.statusCode ?? 'no status')},
  {id: 'image-asset-docs', known: 'task-66985e4bd08cc2d9: no sanity.imageAsset docs (design: /papers/sanity-shaped-image-assets-note)', run: async (c) => (await c.fetch('count(*[_type == "sanity.imageAsset"]) > 0'))},
  {
    id: 'image-url',
    known: 'task-66985e4bd08cc2d9: our studio stores asset-<uuid> refs, which image-url rejects',
    run: async (c, side) => {
      // A stored image ref on each side (the first image field ref found), built into a 200 px URL and fetched.
      // A ref as each studio stores one: Sanity's an image asset id; ours `asset-<media id>`
      // (app/src/lib/image.ts) for the newest image in the media library.
      let ref = await c.fetch('*[_type == "sanity.imageAsset"] | order(_createdAt desc)[0]._id')
      if (!ref && side.imageBase) {
        // Setup, not a client call under test: the media library's newest image.
        const list = await (await fetch(`${side.imageBase}/v1/media/${DATASET}?type=image&limit=1`, {headers: {authorization: `Bearer ${c.config().token}`}})).json()
        const id = (list?.result?.assets ?? list?.assets ?? [])[0]?.id
        ref = id && `asset-${id}`
      }
      if (!ref) return 'no image ref'
      let url
      try { url = createImageUrlBuilder({projectId: side.project, dataset: DATASET, ...(side.imageBase && {baseUrl: side.imageBase})}).image(ref).width(200).url() } catch (e) { return `throws: ${e.message.slice(0, 50)}` }
      const r = await fetch(url, {method: 'GET'})
      return `${r.status} ${(r.headers.get('content-type') ?? '').split('/')[0]}`
    },
  },
  {id: 'result-source-map', run: async (c) => { const r = await c.fetch('*[_id == "post-01"][0]{title}', {}, {filterResponse: false, resultSourceMap: true}); const m = r.resultSourceMap; return m ? {documents: m.documents?.map((d) => d._id), paths: m.paths, mapped: Object.keys(m.mappings ?? {})} : 'none' }},
  {id: 'stega', run: async (c) => { const t = await c.withConfig({stega: {enabled: true, studioUrl: 'http://localhost:3333'}, perspective: 'drafts'}).fetch('*[_id == "post-01"][0].title'); return {encoded: t !== stegaClean(t), clean: stegaClean(t)} }},
]

const answer = async (check, side) => {
  try { return {ok: true, v: await within(20_000, check.run(side.client, side))} } catch (e) { return {ok: false, v: `${e?.name ?? 'Error'}: ${(e?.message ?? String(e)).split('\n')[0].slice(0, 80)}`} }
}
const rows = []
for (const check of CHECKS) {
  if (check.writeProbe && !writeProbes) { rows.push({id: check.id, status: 'skip', known: check.known}); continue }
  const [s, b] = await Promise.all([answer(check, sides.sanity), answer(check, sides.barkpark)])
  const status = !s.ok ? 'REF-ERR' : b.ok && same(s.v, b.v) ? 'pass' : check.known ? 'known' : 'FAIL'
  rows.push({id: check.id, status, s, b, known: check.known})
}
const w = Math.max(...rows.map((r) => r.id.length))
console.log(`@sanity/client conformance · ${DATASET} · v${API} · Sanity ecu57yeh vs Barkpark ${process.env.BARKPARK_WORKSPACE}`)
for (const r of rows) {
  const show = (x) => (typeof x.v === 'string' ? x.v : JSON.stringify(x.v))?.slice(0, 90)
  const why = r.status === 'skip' ? '  writes: run with --write-probes (e2e-local)' : r.status === 'known' ? `  known gap → ${r.known}${detail ? `  (sanity ${show(r.s)} | barkpark ${show(r.b)})` : ''}` : detail || r.status !== 'pass' ? `  sanity ${show(r.s)} | barkpark ${show(r.b)}` : ''
  console.log(`${r.status.padEnd(7)} ${r.id.padEnd(w)}${why}`)
}
const n = (st) => rows.filter((r) => r.status === st).length
console.log(`\n${n('pass')}/${rows.length - n('REF-ERR') - n('skip')} pass · ${n('FAIL') + n('known')} differ${n('known') ? ` (${n('known')} known, with a task)` : ''}${n('skip') ? ` · ${n('skip')} skipped (needs --write-probes)` : ''}${n('REF-ERR') ? ` · ${n('REF-ERR')} reference errors (fix the check)` : ''}`)
process.exit(0)
