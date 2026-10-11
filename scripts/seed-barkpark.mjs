#!/usr/bin/env node
// Reset the Barkpark workspace to fixtures/seed.ndjson, then read it back and compare.
//
//   node --env-file=.env scripts/seed-barkpark.mjs           # schema + reset + verify
//   node --env-file=.env scripts/seed-barkpark.mjs --verify  # verify only
//   node --env-file=.env scripts/seed-barkpark.mjs --data    # reset data, leave schemas (CI token can't write schemas)
//   node --env-file=.env scripts/seed-barkpark.mjs --schemas # schemas only, data untouched (other lanes' datasets)
//   … --no-history                                          # skip rebuilding post-history after a reset
//   … --production                                          # required to write the production dataset
//   … --remove-type <name> [--with-docs] [--yes]            # drop a type whose fixture file is gone (dry run unless --yes)
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
import {sendBatches} from './lib/batches.mjs'
import {idempotent, withRetry} from './lib/retry.mjs'
import {seedAssets} from './lib/seed-assets.mjs'
import {toBarkpark} from './lib/seed-map.mjs'
import {checkJsonSchema} from './lib/json-schema-check.mjs'
import {planRemoveType} from './lib/remove-type.mjs'
import {seedPlan} from './lib/seed-plan.mjs'

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
const NATIVE_TYPES = ['volume', 'story', 'note', 'paper', 'tag', 'siteSettings', 'paper_master', 'task'] // not 'book': Barkpark's onixedit plugin owns that type; siteSettings is B13's singleton (its one doc's id is its type); paper_master: none seeded, a run's masters (D13) are pruned; task: D14's fixture tasks

function fail(msg) {
  console.error(`seed-barkpark: ${msg}`)
  process.exit(1)
}

async function bp(method, path, body, tries = 3) {
  // Reads, schema upserts and deletes land the same if sent twice: asked again through a
  // Barkpark redeploy (lib/retry.mjs).
  const res = await withRetry(
    () => fetch(`${BASE}${path}`, {method, headers: {authorization: `Bearer ${env('BARKPARK_TOKEN')}`, 'content-type': 'application/json'}, body: body && JSON.stringify(body)}),
    {label: `${method} ${path}`},
  )
  const json = await res.json().catch(() => ({}))
  // Rate limited (other lanes share the workspace): wait as told, then retry.
  if (res.status === 429 && tries > 1) {
    await new Promise((r) => setTimeout(r, 1000 * (json.error?.details?.retry_after ?? 1)))
    return bp(method, path, body, tries - 1)
  }
  if (!res.ok) fail(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 500)}`)
  return json
}

// Deletes go in batches under Barkpark's cap (lib/batches.mjs); a 429 waits as told.
const mutate = async (mutations) => {
  const send = async (part, tries = 3) => {
    const res = await withRetry(
      () => fetch(`${BASE}/v1/data/mutate/${DATASET}`, {method: 'POST', headers: {authorization: `Bearer ${env('BARKPARK_TOKEN')}`, 'content-type': 'application/json'}, body: JSON.stringify({mutations: part})}),
      {label: `POST /v1/data/mutate/${DATASET} (${part.length})`, safe: idempotent(part)},
    )
    if (res.status !== 429 || tries <= 1) return res
    await new Promise((r) => setTimeout(r, 1000 * (Number(res.headers.get('retry-after')) || 1)))
    return send(part, tries - 1)
  }
  const res = await sendBatches(mutations, send)
  if (res && !res.ok) fail(`POST /v1/data/mutate/${DATASET} → ${res.status} ${(await res.text()).slice(0, 500)}`)
}

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
const DERIVED = new Set(['body', 'preview', 'body_html', 'body_html_sv', 'blocks', 'created_by', 'claim', 'rev']) // stamped by the server: created_by, claim (tasks), rev (a paper's op rev)
const withoutHtml = (body) => Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'html'))
const stripSystem = (doc, want) =>
  Object.fromEntries(
    Object.entries(doc)
      .filter(([k]) => !k.startsWith('_') && (k !== 'title' || 'title' in want) && !(DERIVED.has(k) && !(k in want)))
      .map(([k, v]) => (k === 'body' && v && typeof v === 'object' && want.body && !('html' in want.body) ? [k, withoutHtml(v)] : [k, v])),
  )

// --remove-type: the other half of --schemas (lib/remove-type.mjs). Its documents (drafts
// too, by published id) are read in pages; nothing is written without --yes.
async function removeType(type) {
  const get = (path) => fetch(`${BASE}${path}`, {headers: {authorization: `Bearer ${env('BARKPARK_TOKEN')}`}})
  const ids = new Set()
  for (let offset = 0; type && !type.startsWith('-'); ) {
    const res = await get(`/v1/data/query/${DATASET}/${encodeURIComponent(type)}?perspective=raw&limit=1000&offset=${offset}`)
    if (res.status === 404) break
    if (!res.ok) fail(`GET query ${type} → ${res.status} ${(await res.text()).slice(0, 300)}`)
    const {result} = await res.json()
    for (const d of result.documents) ids.add(d._publishedId ?? d._id.replace(/^drafts\./, ''))
    if (!result.hasMore) break
    offset = result.nextOffset
  }
  const dir = new URL('fixtures/barkpark-schema/', root)
  const inFixtures = readdirSync(dir).some((f) => f.endsWith('.json') && JSON.parse(readFileSync(new URL(f, dir), 'utf8')).name === type)
  const registered = !!type && (await get(`/v1/schemas/${DATASET}/${encodeURIComponent(type)}`)).ok
  const plan = planRemoveType({
    type,
    dataset: DATASET,
    docs: [...ids].map((id) => ({id})),
    inFixtures,
    seeded: [...TYPES, ...NATIVE_TYPES].includes(type),
    registered,
    production: process.argv.includes('--production'),
    withDocs: process.argv.includes('--with-docs'),
  })
  if (plan.refuse) fail(`--remove-type: ${plan.refuse}`)
  if (plan.done) return console.log(`remove-type: ${plan.done}`)
  const what = `${plan.deletes.length} ${type} document(s)${plan.dropSchema ? `, then the ${type} schema` : ''}, from ${DATASET}`
  if (!process.argv.includes('--yes')) return console.log(`remove-type (dry run): would delete ${what}. Run again with --yes.`)
  if (plan.deletes.length) await mutate(plan.deletes)
  if (plan.dropSchema) await bp('DELETE', `/v1/schemas/${DATASET}/${encodeURIComponent(type)}`)
  console.log(`remove-type: deleted ${what}`)
}
const removeAt = process.argv.indexOf('--remove-type')
if (removeAt !== -1) {
  await removeType(process.argv[removeAt + 1])
  process.exit(0)
}

// ── steps ───────────────────────────────────────────────────────────────────

const seed = readFileSync(new URL('fixtures/seed.ndjson', root), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
// Docs scripts/reference-history.mjs keeps outside the seed (fixture imports rewrite history).
const REFERENCE_ONLY = new Set(['post-history'])
// Task ids are unique across a workspace's datasets (Barkpark refuses a twin), so the
// fixture's tasks (D14) carry the dataset in theirs: `{dataset}` is filled in here.
const native = readFileSync(new URL('fixtures/barkpark-only.ndjson', root), 'utf8').replaceAll('{dataset}', DATASET)
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
// A block doc also holds its bound blocks' values as fields (projection).
const nativeContent = ({_id, _type, ...content}) =>
  Array.isArray(content.blocks) ? {...Object.fromEntries(content.blocks.filter((b) => b.fieldName && b.fieldName !== 'title').map((b) => [b.fieldName, b.value])), ...content} : content
// The seed's files (post.attachment, J54) as this dataset's media; uploaded on first use.
// The plan says whether the seed's files are wanted at all, looked up, or uploaded (lib/seed-plan.mjs).
const plan = seedPlan(process.argv, DATASET)
if (plan.refuse) fail(plan.refuse)
const asset = plan.assets === 'none' ? null : await seedAssets(seed, {base: BASE, dataset: DATASET, token: env('BARKPARK_TOKEN'), upload: plan.assets === 'upload'})
const expectedDocs = () => new Map([...seed.map((d) => [d._id, {type: d._type, content: toBarkpark(d, asset)}]), ...native.map((d) => [d._id, {type: d._type, content: nativeContent(d)}])])

async function applySchemas() {
  const dir = new URL('fixtures/barkpark-schema/', root)
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))])
  // Barkpark ignores a key it doesn't know (task-415c5c02fad8a3c7): a misspelled rule would
  // be applied as no rule. The fixtures must pass fixtures/barkpark-schema.schema.json first.
  const contract = JSON.parse(readFileSync(new URL('fixtures/barkpark-schema.schema.json', root), 'utf8'))
  const problems = files.flatMap(([f, schema]) => checkJsonSchema(contract, schema).map((p) => `${f} ${p}`))
  if (problems.length) fail(`fixture schemas don't pass fixtures/barkpark-schema.schema.json (nothing written):\n  ${problems.join('\n  ')}`)
  for (const [, schema] of files) await bp('POST', `/v1/schemas/${DATASET}`, schema)
}

// Upsert, then prune: the seed is written BEFORE anything is deleted, so a refused write
// (a task id twinned in another dataset, a failed validation: Barkpark answers the whole
// batch with one error) stops the reset with the dataset as it was. Only drafts of seed
// docs are dropped up front: a replace keeps a draft, and publishing would ship it.
async function reset() {
  const existing = []
  for (const type of [...TYPES].reverse().concat(NATIVE_TYPES)) {
    for (const d of await listAll(type, 'raw')) existing.push({type, id: d._publishedId ?? d._id, draft: d._id.startsWith('drafts.')})
  }
  const ordered = TYPES.flatMap((t) => seed.filter((d) => d._type === t))
  const docs = [...ordered.map((d) => ({_id: d._id, _type: d._type, ...toBarkpark(d, asset)})), ...native]
  const seeded = new Set(docs.map((d) => d._id))

  const drafts = [...new Map(existing.filter((e) => e.draft && seeded.has(e.id)).map((e) => [e.id, e])).values()]
  if (drafts.length) await mutate(drafts.map(({id, type}) => ({discardDraft: {id, type}})))
  await mutate(docs.map((d) => ({createOrReplace: d})))
  await mutate(docs.map((d) => ({publish: {id: d._id, type: d._type}})))

  // Then everything the seed doesn't hold goes, references included.
  const extra = [...new Map(existing.filter((e) => !seeded.has(e.id)).map((e) => [e.id, e])).values()]
  if (extra.length) await mutate(extra.map(({id, type}) => ({delete: {id, type, force: true}})))
  console.log(`reset: dropped ${drafts.length} drafts, wrote + published ${docs.length}, deleted ${extra.length} others`)
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

// A --data run keeps the dataset's schemas: say so when they differ from the fixtures
// (a lane seeded before a desk.preview landed showed J62 one page, not ten). A warning,
// not a failure: CI's dataset is ahead of a branch made before a schema change.
async function verifySchemas() {
  const dir = new URL('fixtures/barkpark-schema/', root)
  const stale = []
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const want = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
    const got = (await bp('GET', `/v1/schemas/${DATASET}/${want.name}`)).schema ?? {}
    const names = (s) => (s.fields ?? []).map((x) => x.name).join()
    if (names(want) !== names(got) || !isDeepStrictEqual(want.desk ?? {}, got.desk ?? {})) stale.push(want.name)
  }
  if (stale.length) console.warn(`verify schemas: WARNING ${stale.join(', ')} differ from fixtures/barkpark-schema (run without --data, or with --schemas)`)
  else console.log('verify schemas: as the fixtures')
}

async function verify() {
  await verifySchemas()
  const docs = (await Promise.all([...TYPES, ...NATIVE_TYPES].map((t) => listAll(t, 'raw')))).flat()
  compare('barkpark', docs, expectedDocs())

  if (!process.env.SANITY_TOKEN) return console.log('verify sanity: skipped (no SANITY_TOKEN)')
  const q = encodeURIComponent(`*[_type in ${JSON.stringify(TYPES)}]`)
  const res = await fetch(`https://ecu57yeh.api.sanity.io/v2025-02-19/data/query/production?query=${q}`, {
    headers: {authorization: `Bearer ${process.env.SANITY_TOKEN}`},
  })
  if (!res.ok) fail(`sanity query → ${res.status}`)
  // An asset's id is each backend's own: compare the value around it (a `_sanityAsset`
  // left as is was written, not imported: no file behind it).
  const sanityDocs = (await res.json()).result.map((d) => ({_id: d._id, ...toBarkpark(d, (v) => (v._sanityAsset ? 'not uploaded' : 'asset'))}))
  compare('sanity', sanityDocs, new Map(seed.map((d) => [d._id, {type: d._type, content: toBarkpark(d, () => 'asset')}])))
}

// The editor prefs this token's owner keeps on Barkpark (list sort / view, recent
// searches): a reset dataset starts from the defaults. Best effort (a token with no
// owner has none).
async function resetPrefs() {
  for (const key of ['studio.lists', 'studio.search.recent'])
    await fetch(`${BASE}/v1/prefs/${DATASET}/${key}`, {method: 'DELETE', headers: {authorization: `Bearer ${env('BARKPARK_TOKEN')}`}}).catch(() => {})
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

if (plan.schemas) await applySchemas()
if (plan.reset) {
  await reset()
  await resetPrefs()
  history()
}
if (plan.verify) await verify()
