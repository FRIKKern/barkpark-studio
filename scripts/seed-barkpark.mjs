#!/usr/bin/env node
// Reset the Barkpark workspace to fixtures/seed.ndjson, then read it back and compare.
//
//   node --env-file=.env scripts/seed-barkpark.mjs           # schema + reset + verify
//   node --env-file=.env scripts/seed-barkpark.mjs --verify  # verify only
//   node --env-file=.env scripts/seed-barkpark.mjs --data    # reset data, leave schemas (CI token can't write schemas)
//
// With SANITY_TOKEN set, verify also reads the reference Sanity dataset live and
// checks it maps to the same documents.
import {readFileSync, readdirSync} from 'node:fs'
import {isDeepStrictEqual} from 'node:util'

const root = new URL('..', import.meta.url)
const env = (k, d) => process.env[k] ?? d ?? fail(`missing env ${k} (see .env.example)`)
const BASE = `${env('BARKPARK_URL')}/w/${env('BARKPARK_WORKSPACE')}/p/${env('BARKPARK_PROJECT', 'default')}`
const DATASET = env('BARKPARK_DATASET', 'production')
const TYPES = ['author', 'category', 'post'] // refs point left: posts last

function fail(msg) {
  console.error(`seed-barkpark: ${msg}`)
  process.exit(1)
}

async function bp(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {authorization: `Bearer ${env('BARKPARK_TOKEN')}`, 'content-type': 'application/json'},
    body: body && JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) fail(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 500)}`)
  return json
}

const mutate = (mutations) => bp('POST', `/v1/data/mutate/${DATASET}`, {mutations})

async function listAll(type, perspective) {
  const r = await bp('GET', `/v1/data/query/${DATASET}/${type}?perspective=${perspective}&limit=1000`)
  return r.result.documents
}

// ── Sanity → Barkpark mapping ───────────────────────────────────────────────

const HEADING = /^h([1-6])$/
const MARK_TYPES = {strong: 'strong', em: 'em', code: 'code', underline: 'underline', 'strike-through': 'strikethrough'}

function inline(block) {
  const defs = Object.fromEntries((block.markDefs ?? []).map((d) => [d._key, d]))
  return block.children.map((span) => {
    if (span._type !== 'span') throw new Error(`unmapped inline ${span._type}`)
    // Marks become wrapper nodes, outermost first.
    return (span.marks ?? []).reduceRight((node, mark) => {
      if (MARK_TYPES[mark]) return {type: MARK_TYPES[mark], children: [node]}
      const def = defs[mark]
      if (def?._type === 'link') return {type: 'link', href: def.href, children: [node]}
      throw new Error(`unmapped mark ${mark}`)
    }, {type: 'text', value: span.text})
  })
}

function portableTextToPortableDoc(blocks) {
  return {
    blocks: blocks.map((b) => {
      const id = b._key
      if (b._type === 'callout') return {id, type: 'callout', tone: b.tone, content: [{type: 'text', value: b.text}]}
      if (b._type !== 'block' || b.listItem) throw new Error(`unmapped body block ${b._type}/${b.listItem}`)
      const h = HEADING.exec(b.style)
      if (h) return {id, type: 'heading', level: Number(h[1]), content: inline(b)}
      if (b.style === 'normal') return {id, type: 'paragraph', content: inline(b)}
      if (b.style === 'blockquote') return {id, type: 'pullquote', content: inline(b)}
      throw new Error(`unmapped block style ${b.style}`)
    }),
  }
}

// One Sanity document → the Barkpark content it should equal (no system fields).
function toBarkpark(doc) {
  const out = {}
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('_')) continue
    if (v?._type === 'slug') out[k] = v.current
    else if (v?._type === 'reference') out[k] = v._ref
    else if (k === 'body') out[k] = portableTextToPortableDoc(v)
    else if (Array.isArray(v) && v.every((x) => x?._type === 'reference')) out[k] = v.map((x) => x._ref)
    else out[k] = v
  }
  return out
}

// `title` is a Barkpark row column, present on every type (derived from
// list_preview.title when the type has no title field) — compare it only where
// the seed has one.
const stripSystem = (doc, want) =>
  Object.fromEntries(Object.entries(doc).filter(([k]) => !k.startsWith('_') && (k !== 'title' || 'title' in want)))

// ── steps ───────────────────────────────────────────────────────────────────

const seed = readFileSync(new URL('fixtures/seed.ndjson', root), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
const expected = new Map(seed.map((d) => [d._id, {type: d._type, content: toBarkpark(d)}]))

async function applySchemas() {
  const dir = new URL('fixtures/barkpark-schema/', root)
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    await bp('POST', `/v1/schemas/${DATASET}`, JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
  }
}

async function reset() {
  const existing = []
  for (const type of [...TYPES].reverse()) {
    for (const d of await listAll(type, 'raw')) existing.push({type, id: d._publishedId ?? d._id})
  }
  const ids = [...new Map(existing.map((e) => [e.id, e])).values()]
  if (ids.length) await mutate(ids.map(({id, type}) => ({delete: {id, type}})))

  const ordered = TYPES.flatMap((t) => seed.filter((d) => d._type === t))
  await mutate(ordered.map((d) => ({createOrReplace: {_id: d._id, _type: d._type, ...toBarkpark(d)}})))
  await mutate(ordered.map((d) => ({publish: {id: d._id, type: d._type}})))
  console.log(`reset: deleted ${ids.length}, created + published ${ordered.length}`)
}

function compare(label, docs) {
  const seen = new Map(docs.map((d) => [d._id, d]))
  const problems = []
  for (const [id, want] of expected) {
    const got = seen.get(id)
    if (!got) problems.push(`${id}: missing`)
    else if (!isDeepStrictEqual(stripSystem(got, want.content), want.content))
      problems.push(`${id}: differs\n  want ${JSON.stringify(want.content)}\n  got  ${JSON.stringify(stripSystem(got, want.content))}`)
  }
  for (const id of seen.keys()) if (!expected.has(id)) problems.push(`${id}: not in seed`)
  if (problems.length) fail(`${label}: ${problems.length} problem(s)\n${problems.join('\n')}`)
  console.log(`verify ${label}: ${expected.size}/${expected.size} docs field-by-field equal`)
}

async function verify() {
  const docs = (await Promise.all(TYPES.map((t) => listAll(t, 'raw')))).flat()
  compare('barkpark', docs)

  if (!process.env.SANITY_TOKEN) return console.log('verify sanity: skipped (no SANITY_TOKEN)')
  const q = encodeURIComponent(`*[_type in ${JSON.stringify(TYPES)}]`)
  const res = await fetch(`https://0ozn679s.api.sanity.io/v2025-02-19/data/query/production?query=${q}`, {
    headers: {authorization: `Bearer ${process.env.SANITY_TOKEN}`},
  })
  if (!res.ok) fail(`sanity query → ${res.status}`)
  const sanityDocs = (await res.json()).result.map((d) => ({_id: d._id, ...toBarkpark(d)}))
  compare('sanity', sanityDocs)
}

if (!process.argv.includes('--verify')) {
  if (!process.argv.includes('--data')) await applySchemas()
  await reset()
}
await verify()
