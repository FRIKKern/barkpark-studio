#!/usr/bin/env node
// GROQ conformance (task-bfbdbf049cbae742): real-world Sanity queries run read-only against
// the reference Sanity dataset and Barkpark's, results diffed. The scoreboard for Barkpark
// answering Sanity-shaped GROQ on its own data (refs, slug.current, array _type, pt::text).
// Local only, not CI: it reads two live datasets.
//
//   node --env-file=.env scripts/groq-conformance.mjs            # the table
//   node --env-file=.env scripts/groq-conformance.mjs --diff     # and each failure's first difference
//   node --env-file=.env scripts/groq-conformance.mjs --only ref # queries whose id starts with ref
//
// Reads BARKPARK_URL, BARKPARK_WORKSPACE, BARKPARK_PROJECT, BARKPARK_TOKEN and SANITY_TOKEN.
// The dataset is GROQ_DATASET (default e2e-local), never BARKPARK_DATASET: .env names
// production there, and this compares the seeded test datasets.

const DATASET = process.env.GROQ_DATASET || 'e2e-local'
const API = 'v2025-02-19'
const PROJECT = 'ecu57yeh'
const args = process.argv.slice(2)
const showDiff = args.includes('--diff')
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const need = (k) => process.env[k] || (console.error(`missing env ${k}`), process.exit(2))

// Each: id (source-topic), the query, its params, and whether its order is the query's own.
// Sources: ref = this repo's reference studio and preview site; docs = Sanity's GROQ docs and
// cheat sheet; starter = the next-sanity starter (clean template) patterns.
const Q = [
  // Basics
  {id: 'docs-count-type', q: 'count(*[_type == "post"])'},
  {id: 'docs-order-name', q: '*[_type == "author"] | order(name asc){_id, name}', ordered: true},
  {id: 'docs-by-id', q: '*[_id == "post-01"][0]{title, excerpt, rating}'},
  {id: 'docs-slice', q: '*[_type == "post"] | order(_id asc)[0...3]{_id, title}', ordered: true},
  {id: 'docs-in-ids', q: '*[_id in ["post-01", "post-02", "author-ada"]]{_id, _type}'},
  {id: 'docs-number-filter', q: '*[_type == "post" && rating >= 4] | order(_id asc){_id, rating}', ordered: true},
  {id: 'docs-boolean', q: '*[_type == "post" && featured == true] | order(_id asc)._id', ordered: true},
  {id: 'docs-match', q: '*[_type == "post" && title match "Fixture post 1*"] | order(_id asc)._id', ordered: true},
  {id: 'docs-defined', q: 'count(*[_type == "post" && defined(excerpt)])'},
  {id: 'docs-select', q: '*[_type == "post"] | order(_id asc)[0...4]{_id, "band": select(rating >= 3 => "high", "low")}', ordered: true},
  {id: 'docs-coalesce', q: '*[_type == "post"] | order(_id asc)[0...3]{_id, "date": coalesce(publishedAt, _createdAt)}', ordered: true},
  {id: 'docs-array-count', q: '*[_type == "post"] | order(_id asc)[0...3]{_id, "tags": count(tags)}', ordered: true},
  {id: 'docs-string-fn', q: '*[_id == "post-01"][0]{"lower": lower(title), "upper": upper(title), "starts": string::startsWith(title, "Fixture")}'},
  {id: 'docs-datetime', q: 'count(*[_type == "post" && dateTime(publishedAt) > dateTime("2026-09-10T00:00:00Z")])'},
  {id: 'docs-array-unique', q: 'array::unique(*[_type == "post"].tags[]) | order(@ asc)', ordered: true},
  {id: 'docs-object-proj', q: '*[_id == "post-01"][0]{seo{metaTitle}, "rating2": rating * 2}'},
  {id: 'docs-perspective-root', q: '{"posts": count(*[_type == "post"]), "authors": count(*[_type == "author"])}'},
  // Slugs
  {id: 'docs-slug-project', q: '*[_type == "post"] | order(_id asc)[0...3]{_id, "slug": slug.current}', ordered: true},
  {id: 'docs-slug-filter', q: '*[_type == "post" && slug.current == $slug][0]{_id, title}', params: {slug: 'fixture-post-07'}},
  {id: 'docs-slug-defined', q: 'count(*[_type == "post" && defined(slug.current)])'},
  {id: 'docs-slug-raw', q: '*[_id == "post-01"][0].slug'},
  // References
  {id: 'docs-deref-field', q: '*[_id == "post-01"][0]{"author": author->name}'},
  {id: 'docs-deref-object', q: '*[_id == "post-02"][0]{author->{_id, name}}'},
  {id: 'docs-deref-array', q: '*[_id == "post-06"][0]{"categories": categories[]->title}'},
  {id: 'docs-ref-raw', q: '*[_id == "post-01"][0].author._ref'},
  {id: 'docs-references', q: '*[_type == "post" && references("author-ada")] | order(_id asc)._id', ordered: true},
  {id: 'docs-references-count', q: '*[_type == "author"] | order(name asc){name, "posts": count(*[_type == "post" && references(^._id)])}', ordered: true},
  {id: 'docs-weak-ref', q: '*[_id == "field-types-01"][0]{"weak": weakRef->title, "isWeak": weakRef._weak}'},
  {id: 'docs-ref-filter', q: '*[_type == "post" && author._ref == "author-grace"] | order(_id asc)._id', ordered: true},
  // Arrays with _type
  {id: 'docs-array-type', q: '*[_id == "post-03"][0].links[]{_type, title}'},
  {id: 'docs-array-type-filter', q: '*[_id == "post-03"][0].links[_type == "externalLink"]{title, url}'},
  {id: 'docs-array-key', q: '*[_id == "post-03"][0].links[_key == "l1"][0].title'},
  {id: 'docs-object-type', q: '*[_id == "field-types-01"][0]{"place": place._type, "cards": cards[]._type}'},
  // Portable Text
  {id: 'docs-pt-text', q: '*[_id == "post-01"][0]{"text": pt::text(body)}'},
  {id: 'docs-pt-blocks', q: '*[_id == "post-01"][0]{"blocks": count(body[_type == "block"])}'},
  // The repo's reference preview site and Presentation (real queries, as written)
  {id: 'ref-home', q: '*[_type == "post" && defined(slug.current)] | order(title asc) {_id, title, "slug": slug.current, excerpt, author->{_id, name}}', ordered: true},
  {id: 'ref-post', q: '*[_type == "post" && slug.current == $slug][0] {_id, title, "slug": slug.current, excerpt, author->{_id, name}, categories[]->{_id, title}, related->{_type, _id, title, name, "slug": slug.current}, rating, publishedAt, seo{metaTitle}, links[]{_key, title}}', params: {slug: 'fixture-post-03'}},
  {id: 'ref-author', q: '*[_type == "author" && _id == $id][0] {_id, name, bio, "posts": *[_type == "post" && references(^._id) && defined(slug.current)] | order(title asc) {_id, title, "slug": slug.current, excerpt, author->{_id, name}}}', params: {id: 'author-alan'}},
  {id: 'ref-locations', q: '{"doc": *[_id in [$id, "drafts." + $id]] | order(_updatedAt desc)[0]{_type, title, name, "slug": slug.current}, "referrers": *[_type == "post" && references($id) && defined(slug.current)] | order(title asc){title, "slug": slug.current}}', params: {id: 'author-grace'}},
  // next-sanity starter patterns
  {id: 'starter-more-stories', q: '*[_type == "post" && _id != $skip && defined(slug.current)] | order(publishedAt desc, _updatedAt desc)[0...2]{_id, title, "slug": slug.current, "date": coalesce(publishedAt, _updatedAt), "author": author->{name}}', params: {skip: 'post-30'}, ordered: true},
  {id: 'starter-post-slugs', q: '*[_type == "post" && defined(slug.current)]{"slug": slug.current}'},
  {id: 'starter-heroes', q: '*[_type == "post" && defined(slug.current)] | order(publishedAt desc, _updatedAt desc)[0]{content, _id, title, "slug": slug.current, excerpt, "date": coalesce(publishedAt, _updatedAt), "author": author->{name}}'},
]

const bpBase = `${need('BARKPARK_URL')}/w/${need('BARKPARK_WORKSPACE')}/p/${process.env.BARKPARK_PROJECT || 'default'}/${API}/data/query/${DATASET}`
const sanityBase = `https://${PROJECT}.api.sanity.io/${API}/data/query/${DATASET}`
const url = (base, {q, params = {}}) => {
  const u = new URLSearchParams({query: q, perspective: 'published'})
  for (const [k, v] of Object.entries(params)) u.set(`$${k}`, JSON.stringify(v))
  return `${base}?${u}`
}
async function run(base, token, entry) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url(base, entry), {headers: {authorization: `Bearer ${token}`}})
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 1000 * (i + 1))); continue }
    const body = await r.json().catch(() => ({}))
    return r.ok ? {ok: true, result: body.result} : {ok: false, error: `${r.status} ${(body.error?.description ?? body.error?.message ?? JSON.stringify(body.error ?? body)).slice(0, 90)}`}
  }
  return {ok: false, error: '429'}
}

// What the two backends may differ on without the query meaning anything else.
const SYSTEM = new Set(['_rev', '_createdAt', '_updatedAt', '_system', '_originalId'])
const norm = (v, ordered) => {
  if (Array.isArray(v)) {
    const items = v.map((x) => norm(x, false))
    return ordered ? items : items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).filter((k) => !SYSTEM.has(k) && v[k] !== null).sort().map((k) => [k, norm(v[k], false)]))
  return v
}
const firstDiff = (a, b, path = '') => {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`); if (d) return d }
  }
  return `${path || '(root)'}: sanity ${JSON.stringify(a)?.slice(0, 80)} | barkpark ${JSON.stringify(b)?.slice(0, 80)}`
}

const picked = Q.filter((e) => !only || e.id.startsWith(only))
const sanityToken = need('SANITY_TOKEN'), bpToken = need('BARKPARK_TOKEN')
const rows = []
const queue = [...picked]
await Promise.all(Array.from({length: 4}, async () => {
  for (let e; (e = queue.shift()); ) {
    const [s, b] = await Promise.all([run(sanityBase, sanityToken, e), run(bpBase, bpToken, e)])
    let status, diff
    if (!s.ok) (status = 'REF-ERR'), (diff = `sanity ${s.error}`)
    else if (!b.ok) (status = 'ERROR'), (diff = `barkpark ${b.error}`)
    else {
      diff = firstDiff(norm(s.result, e.ordered), norm(b.result, e.ordered))
      status = diff ? 'FAIL' : 'pass'
    }
    rows.push({id: e.id, status, diff})
  }
}))
rows.sort((a, b) => Q.findIndex((e) => e.id === a.id) - Q.findIndex((e) => e.id === b.id))
const w = Math.max(...rows.map((r) => r.id.length))
console.log(`GROQ conformance · ${DATASET} · ${API} · perspective published · Sanity ${PROJECT} vs Barkpark ${process.env.BARKPARK_WORKSPACE}`)
for (const r of rows) console.log(`${r.status.padEnd(7)} ${r.id.padEnd(w)}${showDiff && r.diff ? `  ${r.diff}` : ''}`)
const n = (s) => rows.filter((r) => r.status === s).length
console.log(`\n${n('pass')}/${rows.length} pass · ${n('FAIL')} differ · ${n('ERROR')} Barkpark errors${n('REF-ERR') ? ` · ${n('REF-ERR')} reference errors (fix the query)` : ''}`)
