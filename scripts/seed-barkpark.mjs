#!/usr/bin/env node
// Reset the Barkpark workspace to fixtures/seed.ndjson, then read it back and compare.
//
//   node --env-file=.env scripts/seed-barkpark.mjs           # schema + reset + verify
//   node --env-file=.env scripts/seed-barkpark.mjs --verify  # verify only
//   node --env-file=.env scripts/seed-barkpark.mjs --data    # reset data, leave schemas (CI token can't write schemas)
//   node --env-file=.env scripts/seed-barkpark.mjs --schemas # schemas only, data untouched (other lanes' datasets)
//   … --no-history                                          # skip rebuilding post-history after a reset
//
// With SANITY_TOKEN set, verify also reads the reference Sanity dataset live and
// checks it maps to the same documents.
//
// Not seeded here: the workspace seats. studio-editor-{a,b,c,d}@example.com are
// members of studio-parity for multi-editor journeys (dev sign-in, presence).
import {spawnSync} from 'node:child_process'
import {readFileSync, readdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {isDeepStrictEqual} from 'node:util'
import {toBarkpark} from './lib/seed-map.mjs'

const root = new URL('..', import.meta.url)
const env = (k, d) => process.env[k] ?? d ?? fail(`missing env ${k} (see .env.example)`)
const BASE = `${env('BARKPARK_URL')}/w/${env('BARKPARK_WORKSPACE')}/p/${env('BARKPARK_PROJECT', 'default')}`
const DATASET = env('BARKPARK_DATASET', 'production')
const TYPES = ['longform', 'author', 'category', 'post'] // refs point left: posts last
// Barkpark-native types: no Sanity mirror, seeded as written (fixtures/barkpark-only.ndjson).
// story and note are PortableDoc types (decision 0004; Sanity has no equivalent): story
// is the Expectation fixture seeded as a block list; note is Freeform-main, with a
// layout + prefill, seeded through its body (create builds its blocks from the layout).
// paper is Bulldocs' paper (D12): its weighted tags must name published `tag` docs, so
// tags are written first and deleted last.
const NATIVE_TYPES = ['volume', 'story', 'note', 'paper', 'tag', 'siteSettings'] // not 'book': Barkpark's onixedit plugin owns that type; siteSettings is B13's singleton (its one doc's id is its type)

function fail(msg) {
  console.error(`seed-barkpark: ${msg}`)
  process.exit(1)
}

async function bp(method, path, body, tries = 3) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {authorization: `Bearer ${env('BARKPARK_TOKEN')}`, 'content-type': 'application/json'},
    body: body && JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  // Rate limited (other lanes share the workspace): wait as told, then retry.
  if (res.status === 429 && tries > 1) {
    await new Promise((r) => setTimeout(r, 1000 * (json.error?.details?.retry_after ?? 1)))
    return bp(method, path, body, tries - 1)
  }
  if (!res.ok) fail(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 500)}`)
  return json
}

const mutate = (mutations) => bp('POST', `/v1/data/mutate/${DATASET}`, {mutations})

async function listAll(type, perspective) {
  const r = await bp('GET', `/v1/data/query/${DATASET}/${type}?perspective=${perspective}&limit=1000`)
  return r.result.documents
}

// `title` is a Barkpark row column, present on every type (derived from
// list_preview.title when the type has no title field) — compare it only where
// the seed has one.
// Projection output (body, preview, body_html, a paper's body_html_sv) is derived, never seeded.
// `blocks` too, for a type whose layout builds them; a seeded body is compared without
// the html Barkpark renders from it.
const DERIVED = new Set(['body', 'preview', 'body_html', 'body_html_sv', 'blocks'])
const withoutHtml = (body) => Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'html'))
const stripSystem = (doc, want) =>
  Object.fromEntries(
    Object.entries(doc)
      .filter(([k]) => !k.startsWith('_') && (k !== 'title' || 'title' in want) && !(DERIVED.has(k) && !(k in want)))
      .map(([k, v]) => (k === 'body' && v && typeof v === 'object' && want.body && !('html' in want.body) ? [k, withoutHtml(v)] : [k, v])),
  )

// ── steps ───────────────────────────────────────────────────────────────────

const seed = readFileSync(new URL('fixtures/seed.ndjson', root), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
// Docs scripts/reference-history.mjs keeps outside the seed (fixture imports rewrite history).
const REFERENCE_ONLY = new Set(['post-history'])
const native = readFileSync(new URL('fixtures/barkpark-only.ndjson', root), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
// A block doc also holds its bound blocks' values as fields (projection).
const nativeContent = ({_id, _type, ...content}) =>
  Array.isArray(content.blocks) ? {...Object.fromEntries(content.blocks.filter((b) => b.fieldName && b.fieldName !== 'title').map((b) => [b.fieldName, b.value])), ...content} : content
const mirrored = new Map(seed.map((d) => [d._id, {type: d._type, content: toBarkpark(d)}]))
const expected = new Map([...mirrored, ...native.map((d) => [d._id, {type: d._type, content: nativeContent(d)}])])

async function applySchemas() {
  const dir = new URL('fixtures/barkpark-schema/', root)
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    await bp('POST', `/v1/schemas/${DATASET}`, JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
  }
}

async function reset() {
  const existing = []
  for (const type of [...TYPES].reverse().concat(NATIVE_TYPES)) {
    for (const d of await listAll(type, 'raw')) existing.push({type, id: d._publishedId ?? d._id})
  }
  const ids = [...new Map(existing.map((e) => [e.id, e])).values()]
  if (ids.length) await mutate(ids.map(({id, type}) => ({delete: {id, type, force: true}}))) // a reset wipes everything, references included

  const ordered = TYPES.flatMap((t) => seed.filter((d) => d._type === t))
  const docs = [...ordered.map((d) => ({_id: d._id, _type: d._type, ...toBarkpark(d)})), ...native]
  await mutate(docs.map((d) => ({createOrReplace: d})))
  // A create doesn't project a block list into its fields (task-b43256e0d9d90733), and on a
  // type with a layout it builds the blocks from the layout + prefill instead of taking
  // ours. A patch of the block list does both right (BoundFieldSync + projection).
  const blockDocs = docs.filter((d) => Array.isArray(d.blocks))
  if (blockDocs.length) await mutate(blockDocs.map((d) => ({patch: {id: d._id, type: d._type, set: {blocks: d.blocks}}})))
  await mutate(docs.map((d) => ({publish: {id: d._id, type: d._type}})))
  console.log(`reset: deleted ${ids.length}, created + published ${docs.length}`)
}

function compare(label, docs, expected) {
  const seen = new Map(docs.map((d) => [d._id, d]))
  const problems = []
  for (const [id, want] of expected) {
    const got = seen.get(id)
    if (!got) problems.push(`${id}: missing`)
    else if (!isDeepStrictEqual(stripSystem(got, want.content), want.content))
      problems.push(`${id}: differs\n  want ${JSON.stringify(want.content)}\n  got  ${JSON.stringify(stripSystem(got, want.content))}`)
  }
  for (const id of seen.keys()) if (!expected.has(id) && !REFERENCE_ONLY.has(id)) problems.push(`${id}: not in seed`)
  if (problems.length) fail(`${label}: ${problems.length} problem(s)\n${problems.join('\n')}`)
  console.log(`verify ${label}: ${expected.size}/${expected.size} docs field-by-field equal`)
}

async function verify() {
  const docs = (await Promise.all([...TYPES, ...NATIVE_TYPES].map((t) => listAll(t, 'raw')))).flat()
  compare('barkpark', docs, expected)

  if (!process.env.SANITY_TOKEN) return console.log('verify sanity: skipped (no SANITY_TOKEN)')
  const q = encodeURIComponent(`*[_type in ${JSON.stringify(TYPES)}]`)
  const res = await fetch(`https://ecu57yeh.api.sanity.io/v2025-02-19/data/query/production?query=${q}`, {
    headers: {authorization: `Bearer ${process.env.SANITY_TOKEN}`},
  })
  if (!res.ok) fail(`sanity query → ${res.status}`)
  const sanityDocs = (await res.json()).result.map((d) => ({_id: d._id, ...toBarkpark(d)}))
  compare('sanity', sanityDocs, mirrored)
}

// J15/J16's post-history is made through each backend's API (an import rewrites
// history), so a reset deletes it. Make it again right after: Barkpark always, the
// reference Sanity too when SANITY_TOKEN is set and its dataset is a test one. Not in
// CI (the history journeys are @evidence, and the CI token can't mint editor B).
function history() {
  if (process.env.CI || process.argv.includes('--no-history')) return
  const sanity = process.env.SANITY_TOKEN && process.env.SANITY_STUDIO_DATASET && process.env.SANITY_STUDIO_DATASET !== 'production'
  const args = [fileURLToPath(new URL('./reference-history.mjs', import.meta.url)), ...(sanity ? [] : ['--barkpark-only'])]
  const run = spawnSync(process.execPath, args, {stdio: 'inherit', env: process.env})
  if (run.status !== 0) console.warn('seed-barkpark: post-history not rebuilt (J15/J16 need it): run scripts/reference-history.mjs by hand')
}

if (process.argv.includes('--schemas')) await applySchemas()
else {
  if (!process.argv.includes('--verify')) {
    if (!process.argv.includes('--data')) await applySchemas()
    await reset()
    history()
  }
  await verify()
}
