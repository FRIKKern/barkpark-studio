#!/usr/bin/env node
// Give one document a real, comparable history on both sides, for the history
// journeys (J16, J15). Fixture imports rewrite history, so `post-history` is not in
// the seed: this script edits it through each backend's API, the way editors would.
//
//   SANITY_STUDIO_DATASET=e2e-local node --env-file=.env scripts/reference-history.mjs [--barkpark-only]
//
// Two authors on each side. Barkpark: BARKPARK_TOKEN, and studio-editor-b@example.com:
// the dev sign-in's own token for editor b (scripts/lib/dev-tokens.mjs) while it works,
// else one minted and kept there (BARKPARK_ADMIN_TOKEN, else BARKPARK_TOKEN, must be an
// admin). CI reads no history (history.spec is evidence only), so there editor a writes
// both parts: a mint per CI reset left a member row each time (157 of them by 2026-10-11). Sanity: SANITY_TOKEN, and SANITY_TOKEN_B if set (e.g. your own
// `npx sanity debug --secrets` token) — otherwise one author there.
// seed-barkpark.mjs runs it after every reset (a reset deletes posts that aren't in the seed).
import {readFileSync} from 'node:fs'
import {devToken, keepDevToken} from './lib/dev-tokens.mjs'

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
// Through the Actions API (create, edit, publish, unpublish), as Sanity Studio
// writes: raw mutations leave a history the Studio can't rebuild ("Since: unknown
// version", empty revisions, failing restore).
const SANITY = 'https://ecu57yeh.api.sanity.io/v2025-02-19/data'
// The reference's test dataset, never its production one (the e2e rig's rule too).
const SANITY_DATASET = process.env.SANITY_STUDIO_DATASET || 'production'
const BARKPARK_ONLY = process.argv.includes('--barkpark-only')
async function act(token, actions, okStatuses = []) {
  const res = await fetch(`${SANITY}/actions/${SANITY_DATASET}`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({actions})})
  if (!res.ok && !okStatuses.includes(res.status)) fail(`sanity actions ${res.status} ${await res.text()}`)
}
async function sanityHistory() {
  const tokens = {a: env('SANITY_TOKEN'), b: process.env.SANITY_TOKEN_B || env('SANITY_TOKEN')}
  const ids = {publishedId: ID, draftId: `drafts.${ID}`}
  const {_id, ...attributes} = base
  // Start over: a deleted document's history no longer counts for the new one.
  await act(tokens.a, [{actionType: 'sanity.action.document.delete', publishedId: ID, includeDrafts: [ids.draftId], purge: false}], [404, 409])
  await act(tokens.a, [{actionType: 'sanity.action.document.create', publishedId: ID, attributes: {...attributes, _id: ids.draftId}, ifExists: 'fail'}])
  await act(tokens.a, [{actionType: 'sanity.action.document.publish', ...ids}])
  for (const [who, action, fields] of STEPS) {
    await pause()
    if (action === 'edit') {
      // An edit on a published doc needs its draft first, as the Studio does.
      await act(tokens[who], [{actionType: 'sanity.action.document.edit', ...ids, patch: {set: fields}}], [409])
    } else await act(tokens[who], [{actionType: `sanity.action.document.${action}`, ...ids}])
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

const EDITOR_B = 'studio-editor-b@example.com'
async function editorB() {
  if (process.env.CI) return env('BARKPARK_TOKEN')
  const kept = devToken(env('BARKPARK_WORKSPACE'), EDITOR_B)
  if (kept && (await fetch(`${BP}/v1/data/query/${DATASET}/post?limit=1`, {headers: {authorization: `Bearer ${kept}`}})).ok) return kept
  // Workspace-wide like the dev sign-in's (no dataset), so every lane and the dev sign-in reuse it.
  const admin = process.env.BARKPARK_ADMIN_TOKEN || env('BARKPARK_TOKEN')
  const res = await fetch(`${env('BARKPARK_URL')}/v1/auth/app-tokens`, {
    method: 'POST',
    headers: {authorization: `Bearer ${admin}`, 'content-type': 'application/json'},
    body: JSON.stringify({email: EDITOR_B, workspace: env('BARKPARK_WORKSPACE'), permissions: ['read', 'write'], label: `app:${EDITOR_B}`}),
  })
  if (!res.ok) fail(`minting editor B's token: ${res.status} ${await res.text()}`)
  const {token} = await res.json()
  keepDevToken(env('BARKPARK_WORKSPACE'), EDITOR_B, token)
  return token
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

if (!BARKPARK_ONLY && SANITY_DATASET === 'production') fail('Sanity writes need SANITY_STUDIO_DATASET=e2e-local (the reference test dataset); or pass --barkpark-only')
await Promise.all([BARKPARK_ONLY ? undefined : sanityHistory(), barkparkHistory()])
