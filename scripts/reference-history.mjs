#!/usr/bin/env node
// Give one document a real, comparable history on both sides, for the history
// journeys (J16, J15). Fixture imports rewrite history, so `post-history` is not in
// the seed: this script edits it through each backend's API, the way editors would.
//
//   node --env-file=.env scripts/reference-history.mjs
//
// Two authors on each side. Barkpark: BARKPARK_TOKEN, and a token the script mints
// for studio-editor-b@example.com (BARKPARK_ADMIN_TOKEN, else BARKPARK_TOKEN, must be
// an admin). Sanity: SANITY_TOKEN, and SANITY_TOKEN_B if set (e.g. your own
// `npx sanity debug --secrets` token) — otherwise one author there.
// Run it after seeding (seed-barkpark's reset deletes posts that aren't in the seed).
import {readFileSync} from 'node:fs'

const ID = 'post-history'
const env = (k, d) => process.env[k] ?? d ?? fail(`missing env ${k} (see .env.example)`)
function fail(msg) {
  console.error(`reference-history: ${msg}`)
  process.exit(1)
}
const pause = (ms = 1200) => new Promise((r) => setTimeout(r, ms)) // distinct timestamps, one entry each

const seed = readFileSync(new URL('../fixtures/seed.ndjson', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .find((d) => d._id === 'post-02')
const base = {...seed, _id: ID, title: 'History fixture', slug: {_type: 'slug', current: 'history-fixture'}, excerpt: 'Before any edit.'}

// The steps, the same on both sides: [author, action, fields].
const STEPS = [
  ['b', 'edit', {title: 'History fixture v2'}],
  ['a', 'edit', {excerpt: 'Edited by A.'}],
  ['a', 'publish'],
  ['b', 'edit', {rating: 4}],
  ['a', 'publish'],
  ['a', 'unpublish'],
  ['b', 'edit', {title: 'History fixture v3'}],
  ['a', 'publish'],
]

// ── Sanity ──────────────────────────────────────────────────────────────────
const SANITY = 'https://0ozn679s.api.sanity.io/v2025-02-19/data'
async function sanity(token, mutations) {
  const res = await fetch(`${SANITY}/mutate/production`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({mutations})})
  if (!res.ok) fail(`sanity mutate ${res.status} ${await res.text()}`)
}
async function sanityGet(id) {
  const q = encodeURIComponent(`*[_id == "${id}"][0]`)
  const res = await fetch(`${SANITY}/query/production?query=${q}&perspective=raw`, {headers: {authorization: `Bearer ${env('SANITY_TOKEN')}`}})
  return (await res.json()).result
}
const strip = ({_rev, _createdAt, _updatedAt, ...d}) => d
async function sanityHistory() {
  const tokens = {a: env('SANITY_TOKEN'), b: process.env.SANITY_TOKEN_B || env('SANITY_TOKEN')}
  await sanity(tokens.a, [{delete: {id: `drafts.${ID}`}}, {createOrReplace: base}])
  for (const [who, action, fields] of STEPS) {
    await pause()
    if (action === 'edit') {
      const live = (await sanityGet(`drafts.${ID}`)) ?? (await sanityGet(ID))
      await sanity(tokens[who], [{createIfNotExists: {...strip(live), _id: `drafts.${ID}`}}, {patch: {id: `drafts.${ID}`, set: fields}}])
    } else if (action === 'publish') {
      const draft = await sanityGet(`drafts.${ID}`)
      if (draft) await sanity(tokens[who], [{createOrReplace: {...strip(draft), _id: ID}}, {delete: {id: `drafts.${ID}`}}])
    } else {
      const published = await sanityGet(ID)
      await sanity(tokens[who], [{createOrReplace: {...strip(published), _id: `drafts.${ID}`}}, {delete: {id: ID}}])
    }
  }
  console.log(`sanity: ${ID} has ${STEPS.length + 1} steps of history${process.env.SANITY_TOKEN_B ? ' by two authors' : ' (one author: set SANITY_TOKEN_B for two)'}`)
}

// ── Barkpark ────────────────────────────────────────────────────────────────
const BP = `${env('BARKPARK_URL')}/w/${env('BARKPARK_WORKSPACE')}/p/${env('BARKPARK_PROJECT', 'default')}`
const DATASET = env('BARKPARK_DATASET', 'production')
async function bp(token, mutations) {
  const res = await fetch(`${BP}/v1/data/mutate/${DATASET}`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({mutations})})
  if (!res.ok) fail(`barkpark mutate ${res.status} ${await res.text()}`)
}
// The seed's Sanity shapes → Barkpark's, for the few fields this doc carries.
const toBarkpark = ({_id, _type, slug, author, categories, body, attachment, links, ...rest}) => ({...rest, slug: slug.current, author: author._ref})

async function editorB() {
  const admin = process.env.BARKPARK_ADMIN_TOKEN || env('BARKPARK_TOKEN')
  const res = await fetch(`${env('BARKPARK_URL')}/v1/auth/app-tokens`, {
    method: 'POST',
    headers: {authorization: `Bearer ${admin}`, 'content-type': 'application/json'},
    body: JSON.stringify({email: 'studio-editor-b@example.com', workspace: env('BARKPARK_WORKSPACE'), permissions: ['read', 'write'], label: 'app:studio-editor-b@example.com', dataset: DATASET}),
  })
  if (!res.ok) fail(`minting editor B's token: ${res.status} ${await res.text()}`)
  return (await res.json()).token
}

async function barkparkHistory() {
  const tokens = {a: env('BARKPARK_TOKEN'), b: await editorB()}
  await fetch(`${BP}/v1/data/mutate/${DATASET}`, {
    method: 'POST',
    headers: {authorization: `Bearer ${tokens.a}`, 'content-type': 'application/json'},
    body: JSON.stringify({mutations: [{delete: {id: ID, type: 'post', force: true}}]}),
  })
  await bp(tokens.a, [{createOrReplace: {_id: ID, _type: 'post', ...toBarkpark(base)}}, {publish: {id: ID, type: 'post'}}])
  for (const [who, action, fields] of STEPS) {
    await pause()
    if (action === 'edit') await bp(tokens[who], [{patch: {id: ID, type: 'post', set: fields}}])
    else await bp(tokens[who], [{[action]: {id: ID, type: 'post'}}])
  }
  console.log(`barkpark (${DATASET}): ${ID} has ${STEPS.length + 1} steps of history by two authors`)
}

await Promise.all([sanityHistory(), barkparkHistory()])
