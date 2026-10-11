#!/usr/bin/env node
// Spec hygiene (task-ebf7a7893f74dc3b): every spec restores what it edits, so the suite
// runs twice in a row with no reseed. This takes a snapshot of a dataset's documents
// (drafts and published) on both sides, and compares a later one to it.
//
//   node --env-file=.env scripts/fixture-diff.mjs snapshot before.json   # BARKPARK_DATASET, SANITY_STUDIO_DATASET
//   node --env-file=.env scripts/fixture-diff.mjs compare before.json    # exit 1 on a difference
//
// Bookkeeping fields (_rev, timestamps, flags the read adds) are left out: a spec that
// writes a value and puts it back is clean, one that leaves a draft or a doc is not.
import {readFileSync, writeFileSync} from 'node:fs'
import {isDeepStrictEqual} from 'node:util'

const [mode, file] = process.argv.slice(2)
if (!['snapshot', 'compare'].includes(mode) || !file) {
  console.error('Usage: fixture-diff.mjs snapshot|compare <file.json>')
  process.exit(2)
}
const env = (k, d) => process.env[k] ?? d
const BASE = `${env('BARKPARK_URL')}/w/${env('BARKPARK_WORKSPACE', 'studio-parity')}/p/${env('BARKPARK_PROJECT', 'default')}`
const DATASET = env('BARKPARK_DATASET', 'e2e-local')
const SANITY_DATASET = env('SANITY_STUDIO_DATASET', 'e2e-local')
// Schemaless types the studio writes too (comments, tasks), and Barkpark-native ones.
const EXTRA = ['tag', 'paper_master', 'task', 'studioComment', 'studioTask']
// `rev` and `body_html_*` are a paper's own server-side render (rebuilt from an unchanged body).
const BOOKKEEPING = /^(_(rev|createdAt|updatedAt|draft|publishedId|hasPublished|publishedAt|seq|version|system)|rev|body_html_\w+)$/

const tidy = (doc) => Object.fromEntries(Object.entries(doc).filter(([k]) => !BOOKKEEPING.test(k)))

async function json(url, headers) {
  for (let tries = 3; ; tries--) {
    const res = await fetch(url, {headers})
    if (res.status === 429 && tries > 1) {
      await new Promise((r) => setTimeout(r, 1500))
      continue
    }
    if (!res.ok) throw new Error(`${url} → ${res.status}`)
    return res.json()
  }
}

async function barkpark() {
  const H = {authorization: `Bearer ${env('BARKPARK_TOKEN')}`}
  const schemas = await json(`${BASE}/v1/schemas/${DATASET}`, H)
  const types = [...new Set([...(schemas.schemas ?? schemas).map((s) => s.name), ...EXTRA])]
  const docs = {}
  for (const type of types)
    for (let offset = 0; ; offset += 500) {
      const r = (await json(`${BASE}/v1/data/query/${DATASET}/${type}?perspective=raw&limit=500&offset=${offset}`, H)).result
      for (const d of r.documents) docs[`${d._draft ? 'drafts.' : ''}${d._publishedId ?? d._id}`] = tidy(d)
      if (!r.hasMore) break
    }
  return docs
}

async function sanity() {
  if (!env('SANITY_TOKEN')) return null
  const q = encodeURIComponent('*[!(_id in path("_.**")) && !(_type match "system.*") && _type != "sanity.previewUrlSecret"]')
  const r = await json(`https://ecu57yeh.api.sanity.io/v2025-02-19/data/query/${SANITY_DATASET}?query=${q}&perspective=raw`, {authorization: `Bearer ${env('SANITY_TOKEN')}`})
  return Object.fromEntries(r.result.map((d) => [d._id, tidy(d)]))
}

const now = {barkpark: await barkpark(), sanity: await sanity()}
if (mode === 'snapshot') {
  writeFileSync(file, JSON.stringify(now))
  console.log(`snapshot: barkpark ${DATASET} ${Object.keys(now.barkpark).length} docs, sanity ${now.sanity ? `${SANITY_DATASET} ${Object.keys(now.sanity).length} docs` : 'skipped (no SANITY_TOKEN)'}`)
  process.exit(0)
}
const before = JSON.parse(readFileSync(file, 'utf8'))
let dirty = 0
for (const side of ['barkpark', 'sanity']) {
  const a = before[side] && Object.fromEntries(Object.entries(before[side]).map(([id, d]) => [id, tidy(d)]))
  const b = now[side]
  if (!a || !b) continue
  for (const id of Object.keys(b)) if (!(id in a)) (dirty++, console.log(`${side}: left behind  ${id} (${b[id]._type})`))
  for (const id of Object.keys(a)) if (!(id in b)) (dirty++, console.log(`${side}: gone          ${id} (${a[id]._type})`))
  for (const id of Object.keys(a))
    if (id in b && !isDeepStrictEqual(a[id], b[id])) {
      dirty++
      const keys = [...new Set([...Object.keys(a[id]), ...Object.keys(b[id])])].filter((k) => !isDeepStrictEqual(a[id][k], b[id][k]))
      console.log(`${side}: changed       ${id} (${a[id]._type}): ${keys.join(', ')}`)
    }
}
console.log(dirty ? `${dirty} difference(s)` : 'clean: no fixture document differs')
process.exit(dirty ? 1 : 0)
