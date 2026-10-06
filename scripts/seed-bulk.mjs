#!/usr/bin/env node
// J41's big list: 5,000 `bulk` docs in the Barkpark dataset and the reference Sanity
// dataset. Kept out of seed-barkpark.mjs so the main seed stays small and fast.
//
//   node --env-file=.env scripts/seed-bulk.mjs     # BARKPARK_DATASET, default production
import {readFileSync} from 'node:fs'

const N = 5000
const BATCH = 250
const env = (k, d) => process.env[k] ?? d ?? fail(`missing env ${k}`)
const BASE = `${env('BARKPARK_URL')}/w/${env('BARKPARK_WORKSPACE')}/p/${env('BARKPARK_PROJECT', 'default')}`
const DATASET = env('BARKPARK_DATASET', 'production')
function fail(msg) {
  console.error(`seed-bulk: ${msg}`)
  process.exit(1)
}

const docs = Array.from({length: N}, (_, i) => {
  const n = String(i + 1).padStart(4, '0')
  return {_id: `bulk-${n}`, _type: 'bulk', title: `Bulk item ${n}`}
})

// Barkpark's write budget is per token per minute: pace the batches, wait out a 429.
async function bp(method, path, body) {
  for (;;) {
    const res = await fetch(`${BASE}${path}`, {method, headers: {authorization: `Bearer ${env('BARKPARK_TOKEN')}`, 'content-type': 'application/json'}, body: JSON.stringify(body)})
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2) * 1000))
      continue
    }
    if (!res.ok) fail(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`)
    return res.json()
  }
}

await bp('POST', `/v1/schemas/${DATASET}`, JSON.parse(readFileSync(new URL('../fixtures/barkpark-schema/bulk.json', import.meta.url), 'utf8')))
for (let i = 0; i < N; i += BATCH) {
  const part = docs.slice(i, i + BATCH)
  await bp('POST', `/v1/data/mutate/${DATASET}`, {mutations: part.map((d) => ({createOrReplace: d}))})
  await bp('POST', `/v1/data/mutate/${DATASET}`, {mutations: part.map((d) => ({publish: {id: d._id, type: 'bulk'}}))})
  process.stdout.write(`\rbarkpark ${DATASET}: ${i + part.length}/${N}`)
}
console.log()

if (process.env.SANITY_TOKEN) {
  const api = 'https://0ozn679s.api.sanity.io/v2025-02-19/data/mutate/production'
  for (let i = 0; i < N; i += BATCH) {
    const res = await fetch(api, {
      method: 'POST',
      headers: {authorization: `Bearer ${process.env.SANITY_TOKEN}`, 'content-type': 'application/json'},
      body: JSON.stringify({mutations: docs.slice(i, i + BATCH).map((d) => ({createOrReplace: d}))}),
    })
    if (!res.ok) fail(`sanity → ${res.status} ${(await res.text()).slice(0, 300)}`)
    process.stdout.write(`\rsanity production: ${Math.min(i + BATCH, N)}/${N}`)
  }
  console.log()
}
