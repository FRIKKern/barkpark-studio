import {queryOptions, type QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {getCookie} from '@tanstack/react-start/server'
import {bpFetch, dataset, requestToken} from '../server/barkpark'
import {resumeMark} from '../server/listen'
import {readDesk, readRest, readSchemas, schemaIcon, STUDIO_TYPES} from '../server/schemas'
import type {Condition} from './conditions'
import {paneRetry} from './connection'
import {collate, translate, type T} from './i18n'
import {deskFilterParams, normalizeDesk, orGroupRefused, type DeskFilter, type DeskNode} from './desk'
import {listSearch} from './list-search'
import type {Sort} from './list-prefs'
import {pathsOf, type PreviewMediaSpec, type PreviewText} from './preview'
import {excluded, memberPreviewRefs, parseTextQuery, refBoost, textScore, tieLength} from './text-search'
import {groqKeepPath, isGroqFilter, referencingPath, refFilterParams, type RefFilter} from './ref-filter'

// Every read the studio does. Server functions: on the server they call Barkpark
// directly (SSR), in the browser they are same-origin RPC — the token never leaves.

// `_hasPublished` is ours, not Barkpark's: the drafts perspective can't tell a
// draft of a published doc from a brand-new draft, so reads ask both perspectives.
// `_publishedAt` (also ours): when the published version last changed, for the
// list rows' status tooltip (J56).
export type Doc = {_id: string; _publishedId: string; _type: string; _draft: boolean; _rev: string; _updatedAt: string; _hasPublished?: boolean; _publishedAt?: string} & Record<
  string,
  unknown
>
/** Barkpark's field rule: Sanity's checks, `level` (default error) and a `message` that replaces the generated one. */
export type Rule = {required?: boolean; min?: number; max?: number; pattern?: string; unique?: boolean; level?: string; message?: string}

export type Field = {
  name: string
  title?: string
  /** Sanity's field description: muted help text under the label. */
  description?: string
  type: string
  refType?: string
  /** A reference's target types; Barkpark keeps `to` as given, `refType` is its first. */
  to?: {type: string}[]
  rows?: number
  of?: Field
  fields?: Field[]
  options?: Record<string, unknown> | unknown[]
  layout?: string
  group?: string
  /** A rule map or a list of them; `level` warning/info never blocks publish (J13). */
  validation?: Rule | Rule[]
  /** J18: an array member's starting values (Sanity's initialValue on `of`). */
  initialValue?: Record<string, unknown>
  /** localizedText (B04/B06): the languages it holds. */
  languages?: string[]
  /** localizedText: the order readers fall back through; its first is the primary language. */
  fallbackChain?: string[]
  /** richText: `blocks` means Barkpark's block editor (the canvas). */
  editor?: string
  /** codelist (B04/B05): `<plugin>:<name>`. */
  codelistId?: string
  /** An array member that is a named object type (Barkpark expands it): the type, for its icon. */
  namedType?: string
  /** Array item preview (J33): title, subtitle and media, read like a list preview (lib/preview.ts). */
  preview?: {title?: PreviewText; subtitle?: PreviewText; media?: PreviewMediaSpec}
  visibleWhen?: Condition
  readOnly?: boolean | Condition
  /** Sanity's fieldsets on an object: [{name, title, options: {collapsible, collapsed, columns}}]. */
  fieldsets?: {name: string; title?: string; options?: {collapsible?: boolean; collapsed?: boolean; columns?: number}}[]
  /** The fieldset (of its object) this field shows in. */
  fieldset?: string
  /** reference: Sanity's weak reference (kept as declared; Barkpark doesn't enforce it). */
  weak?: boolean
}
export type Group = {name: string; title?: string; default?: boolean}
/** J55: a type's own sort, Sanity's `orderings` (Barkpark: the schema's `desk.orderings`). */
export type Ordering = {name: string; title: string; by: {field: string; direction: 'asc' | 'desc'}[]}
/** A row's preview: title and media name fields; the subtitle may be prepared (J56, lib/preview.ts). */
export type ListPreview = {title?: string; subtitle?: PreviewText; media?: PreviewMediaSpec}
/** One entry of a type's Expectation (Barkpark's `layout`): a bound field block, or the free region. */
export type LayoutItem = {kind: 'field' | 'region' | string; name: string; max?: number; enforce?: boolean}
export type Schema = {name: string; title: string; kind?: 'object'; icon?: string; iconSvg?: string; previewView?: {title?: string}; fields: Field[]; listPreview?: ListPreview; groups?: Group[]; fieldsets?: Field['fieldsets']; initialValues?: Record<string, unknown>; orderings?: Ordering[]; singleton?: boolean; views?: DeskView[]; preview?: string; layout?: LayoutItem[]; prefill?: Record<string, unknown>}
/**
 * B09: a related-documents view the schema declares (`desk.views`, Barkpark's LiveView
 * "view bar"): docs of `type` whose `by` field references the open doc.
 */
export type DeskView = {id: string; title: string; type: string; by: string; orderings?: {field: string; direction: 'asc' | 'desc'}[]}

type RawOrdering = {name?: string; title?: string; field?: string; direction?: 'asc' | 'desc'; by?: Ordering['by']}
const startCase = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
const ordering = (o: RawOrdering): Ordering => {
  const by = o.by ?? [{field: o.field!, direction: o.direction ?? 'asc'}]
  return {name: o.name ?? by.map((b) => `${b.field}${startCase(b.direction)}`).join(''), title: o.title ?? startCase(by[0]!.field), by}
}
/** An ordering as the list's sort (Barkpark's order expression). */
export const orderingSort = (o: Ordering) => o.by.map((b) => `${b.field}:${b.direction}`).join(',') as Sort

// Server functions return plain JSON; the typed views below cast it once.
type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

async function bpJson<T>(path: string): Promise<T> {
  const res = await bpFetch(path)
  if (!res.ok) throw new Error(`Barkpark ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

const previewViewOf = (v: unknown): {previewView?: {title?: string}} =>
  v === true ? {previewView: {}} : v && typeof v === 'object' ? {previewView: typeof (v as {title?: unknown}).title === 'string' ? {title: (v as {title: string}).title} : {}} : {}

const fetchSchemas = createServerFn({method: 'GET'}).handler(async () => {
  const schemas = await readSchemas()
  return schemas
    .map(({name, title, icon, fields, listPreview, list_preview, groups, fieldsets, initialValues, initial_values, desk, singleton, layout, prefill, kind}) => ({
      name, title, fields,
      // The type's icon: a row with no media draws it, as Sanity's do.
      ...schemaIcon(icon),
      // "object": a named composite other schemas embed (a page-builder section); it owns
      // no documents, so nothing offers to create one (task-37691740e53e77b7).
      ...(kind === 'object' ? {kind: 'object'} : {}), listPreview: listPreview ?? list_preview, groups: groups ?? [], fieldsets: Array.isArray(fieldsets) ? fieldsets : [], initialValues: initialValues ?? initial_values ?? {},
      layout: Array.isArray(layout) ? layout : [], prefill: prefill ?? {},
      singleton: singleton === true,
      orderings: ((desk as {orderings?: RawOrdering[]} | undefined)?.orderings ?? []).filter((o) => o.field || o.by?.length).map(ordering),
      views: ((desk as {views?: Json[]} | undefined)?.views ?? []) as Json[],
      // The type's preview URL template (desk.preview): Presentation and "Used on N pages"
      // read it. The Preview VIEW is opt-in, as a declared view in Sanity's structure is:
      // desk.previewView true, or {title} (task-37691740e53e77b7).
      ...(typeof (desk as {preview?: unknown} | undefined)?.preview === 'string' ? {preview: (desk as {preview: string}).preview} : {}),
      ...previewViewOf((desk as {previewView?: unknown} | undefined)?.previewView),
    })) as unknown as Json
})

// J41, Sanity's paging: a list opens with its first LIST_PAGE rows and loads up to
// LIST_MAX when you scroll near the end; past that it says so. Order is the server's.
export const LIST_PAGE = 100
export const LIST_MAX = 2000
export type ListOrder = Sort
const ORDER: Record<string, string> = {updated: '_updatedAt:desc', created: '_createdAt:desc', title: 'title:asc'}
// A type ordering arrives as its own order expression; anything else (an old cookie) falls back to last edited.
// Ties keep creation order, as Sanity's do (its ties fall back to document order).
const ORDER_EXPR = /^[A-Za-z_][\w.]*:(asc|desc)(,[A-Za-z_][\w.]*:(asc|desc))*$/
const orderParam = (o: ListOrder | undefined) => ORDER[o ?? 'updated'] ?? (ORDER_EXPR.test(o!) ? `${o},_createdAt:asc` : ORDER.updated)
/** One loaded list: its rows, and whether the server holds more. */
/** `unsupported`: filter ops the server refused, shown as the list's advisory. */
export type ListPage = {docs: Doc[]; hasMore: boolean; unsupported?: string[]}

/** A desk list's filter as query parameters (B12), `$or` groups included (lib/desk deskFilterParams). */
const filterParams = (filter?: DeskFilter) => deskFilterParams(filter)

const fetchList = createServerFn({method: 'GET'})
  .validator((d: {type: string; published?: boolean; limit?: number; order?: ListOrder; filter?: DeskFilter}) => d)
  .handler(async ({data}) => {
    const limit = Math.min(data.limit ?? LIST_PAGE, LIST_MAX)
    const docs: Doc[] = []
    let hasMore = true
    // Barkpark serves at most 1000 rows a request.
    while (hasMore && docs.length < limit) {
      const path = `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?order=${orderParam(data.order)}&limit=${Math.min(limit - docs.length, 1000)}&offset=${docs.length}&perspective=${data.published ? 'published' : 'drafts'}${filterParams(data.filter)}`
      const res = await bpFetch(path)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        // A Barkpark without `$or` groups (before #23981): the advisory, not a failed list.
        if (orGroupRefused(data.filter, res.status, body)) return {docs: [], hasMore: false, unsupported: ['$or']} as unknown as Json
        throw new Error(`Barkpark ${path} → ${res.status}`)
      }
      const r = (await res.json()) as {result: {documents: Doc[]; hasMore: boolean}}
      docs.push(...r.result.documents)
      hasMore = r.result.hasMore
    }
    const out = data.published ? docs.map((d) => ({...d, _hasPublished: true, _publishedAt: d._updatedAt})) : await withHasPublished(data.type, docs)
    return {docs: out, hasMore} as unknown as Json
  })

// B09: a desk view's rows, as Barkpark's LiveView reads them (handlers/views.ex):
// drafts perspective, at most 200, `by` equal to the open doc's published id.
const fetchRelated = createServerFn({method: 'GET'})
  .validator((d: {view: DeskView; id: string}) => d)
  .handler(async ({data}) => {
    const {type, by, orderings = []} = data.view
    const order = orderings.length ? `&order=${orderings.map((o) => `${o.field}:${o.direction}`).join(',')}` : ''
    const r = await bpJson<{result: {documents: Doc[]}}>(
      `/v1/data/query/${dataset()}/${encodeURIComponent(type)}?perspective=drafts&limit=200&filter[${encodeURIComponent(by)}][eq]=${encodeURIComponent(data.id)}${order}`,
    )
    return (await withHasPublished(type, r.result.documents)) as unknown as Json
  })

export const relatedQuery = (view: DeskView, id: string) =>
  queryOptions({queryKey: ['related', view.type, view.by, id], staleTime: 5_000, queryFn: async () => (await fetchRelated({data: {view, id}})) as unknown as Doc[]})

/** List search over the whole type, not just the rows loaded (J41): Barkpark's full-text search. */
const fetchListSearch = createServerFn({method: 'GET'})
  .validator((d: {type: string; q: string}) => d)
  .handler(async ({data}) => {
    const search = (q: string, limit: number) =>
      bpJson<{documents: Doc[]; count: number}>(`/v1/data/search/${dataset()}?q=${encodeURIComponent(q)}&type=${encodeURIComponent(data.type)}&limit=${limit}&perspective=drafts`)
    const documents = await listSearch(data.q, LIST_PAGE, search)
    return (await withHasPublished(data.type, documents)) as unknown as Json
  })

// A reference with several target types names them all; the doc is whichever has the id.
const fetchDoc = createServerFn({method: 'GET'})
  .validator((d: {type: string | string[]; id: string}) => d)
  .handler(async ({data}) => {
    let types = [data.type].flat()
    // An id any of several types may hold (presence names a doc by id only): one read names
    // its type. Asking each type in turn was a read per type, 64 in a row for a 64-type model.
    if (types.length > 1) {
      const type = (await typesOf([data.id]))[data.id]
      if (!type || !types.includes(type)) return null
      types = [type]
    }
    for (const type of types) {
      const path = `/v1/data/doc/${dataset()}/${encodeURIComponent(type)}/${encodeURIComponent(data.id)}?perspective=drafts`
      const res = await bpFetch(path)
      if (res.status === 404) continue
      if (!res.ok) throw new Error(`Barkpark ${path} → ${res.status}`)
      const [doc] = await withHasPublished(type, [((await res.json()) as {result: Doc}).result])
      return doc as unknown as Json
    }
    return null
  })

const fetchPublished = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string}) => d)
  .handler(async ({data}) => {
    const path = `/v1/data/doc/${dataset()}/${encodeURIComponent(data.type)}/${encodeURIComponent(data.id)}?perspective=published`
    const res = await bpFetch(path)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Barkpark ${path} → ${res.status}`)
    return ((await res.json()) as {result: Json}).result
  })

/** The published version alone (the Published perspective), null if there is none. */
export const publishedQuery = (type: string, id: string) =>
  queryOptions({queryKey: ['doc-published', id], staleTime: 30_000, ...paneRetry, queryFn: async () => (await fetchPublished({data: {type, id}})) as unknown as Doc | null})

/**
 * Mark which docs have a published version. A row read through the drafts
 * perspective that is not a draft is published; only drafts need asking, in one
 * query for the lot.
 */
async function withHasPublished(type: string, docs: Doc[]): Promise<Doc[]> {
  const drafts = docs.filter((d) => d._draft).map((d) => d._publishedId)
  let live = new Map<string, string>()
  if (drafts.length) {
    const ids = drafts.map(encodeURIComponent).join(',')
    const r = await bpJson<{result: {documents: Doc[]}}>(
      `/v1/data/query/${dataset()}/${encodeURIComponent(type)}?perspective=published&limit=200&filter[_id][in]=${ids}`,
    )
    live = new Map(r.result.documents.map((d) => [d._id, d._updatedAt]))
  }
  return docs.map((d) => ({...d, _hasPublished: !d._draft || live.has(d._publishedId), _publishedAt: d._draft ? live.get(d._publishedId) : d._updatedAt}))
}

/** Several docs of one type in one request (reference previews in a loader). */
const fetchMany = createServerFn({method: 'GET'})
  .validator((d: {type: string; ids: string[]}) => d)
  .handler(async ({data}) => {
    // `_id in` matches a draft only by its drafts. id: a never-published doc has no other.
    const ids = data.ids.flatMap((id) => [id, `drafts.${id}`]).map(encodeURIComponent).join(',')
    const r = await bpJson<{result: {documents: Doc[]}}>(
      `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?perspective=drafts&limit=400&filter[_id][in]=${ids}`,
    )
    const byId = new Map<string, Doc>()
    for (const d of r.result.documents) if (d._draft || !byId.has(d._publishedId)) byId.set(d._publishedId, d)
    return (await withHasPublished(data.type, [...byId.values()])) as unknown as Json
  })

/** Put any of `ids` not already cached into the cache, with one request per type. */
export async function ensureDocs(client: QueryClient, types: string[], ids: string[]) {
  const missing = [...new Set(ids)].filter((id) => client.getQueryData(['doc', id]) === undefined)
  if (!missing.length) return
  const docs = (await Promise.all(types.map((type) => fetchMany({data: {type, ids: missing}})))).flat() as unknown as Doc[]
  for (const d of docs) client.setQueryData(['doc', d._publishedId], d)
  for (const id of missing) if (client.getQueryData(['doc', id]) === undefined) client.setQueryData(['doc', id], null)
}

/** The types of `ids` (published or draft spelling), in one read: `{id: type}`. */
async function typesOf(ids: string[]): Promise<Record<string, string>> {
  const qs = new URLSearchParams({query: '*[_id in $ids]{_id, _type}', perspective: 'raw'})
  qs.set('$ids', JSON.stringify(ids.flatMap((id) => [id, `drafts.${id}`])))
  const r = await bpJson<{result: {_id: string; _type: string}[]}>(`/v2025-02-19/data/query/${dataset()}?${qs}`)
  return Object.fromEntries(r.result.map((d) => [d._id.replace(/^drafts\./, ''), d._type]))
}
const fetchTypesOf = createServerFn({method: 'GET'})
  .validator((d: {ids: string[]}) => d)
  .handler(async ({data}) => typesOf(data.ids))

/**
 * `anyDocQuery`'s cache for `ids`, in batches: their types in one read, then `ensureDocs`
 * per type. One `anyDocQuery` per row was two reads per row; a missing doc is cached as
 * null, as anyDocQuery answers it.
 */
export async function ensureAnyDocs(client: QueryClient, ids: string[]) {
  const missing = [...new Set(ids)].filter((id) => client.getQueryData(['doc-any', id]) === undefined)
  if (!missing.length) return
  const types = await fetchTypesOf({data: {ids: missing}})
  const byType = new Map<string, string[]>()
  for (const id of missing) if (types[id]) byType.set(types[id], [...(byType.get(types[id]) ?? []), id])
  await Promise.all([...byType].map(([type, of]) => ensureDocs(client, [type], of)))
  for (const id of missing) client.setQueryData(['doc-any', id], client.getQueryData<Doc | null>(['doc', id]) ?? null)
}

export type {RefFilter} from './ref-filter'
/** A GROQ filter (Sanity's form) keeps only the docs it matches: one read over their ids. */
async function groqKept<D extends {_id: string; _publishedId?: string}>(filter: RefFilter | undefined, docs: D[]): Promise<D[]> {
  if (!isGroqFilter(filter) || !docs.length) return docs
  const ids = [...new Set(docs.map((d) => d._id))]
  const keep = new Set((await bpJson<{result: string[]}>(groqKeepPath(dataset(), filter, ids))).result)
  return docs.filter((d) => keep.has(d._id))
}

const fetchSearch = createServerFn({method: 'GET'})
  .validator((d: {type: string; q: string; filter?: RefFilter; order?: string; limit?: number}) => d)
  .handler(async ({data}) => {
    // `contains` is case-insensitive; `title` is the row's preview title for every type.
    // `order` (J38): `_updatedAt:desc` (default) or `_createdAt:desc`.
    const filter = (data.q ? `&filter[title][contains]=${encodeURIComponent(data.q)}` : '') + refFilterParams(data.filter)
    // A GROQ filter runs after the search (groqKept): ask for more, so the list stays full.
    const limit = Math.min(data.limit ?? 20, 100)
    const r = await bpJson<{result: {documents: Doc[]}}>(
      `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?perspective=drafts&order=${encodeURIComponent(data.order ?? '_updatedAt:desc')}&limit=${isGroqFilter(data.filter) ? 100 : limit}${filter}`,
    )
    return (await groqKept(data.filter, r.result.documents)).slice(0, limit) as unknown as Json
  })

/**
 * J38: global search over every text field, Sanity's way. Barkpark's search
 * (title + every content string) finds the candidates; each type's query then
 * narrows them by its field filters, so those keep Barkpark's own semantics;
 * textScore keeps the hits Sanity would show and scores them. The best `limit`
 * by `order` (`_score:desc` is best match) come back with `_score` set.
 */
const fetchTextSearch = createServerFn({method: 'GET'})
  .validator((d: {q: string; groups: {types: string[]; filter: RefFilter}[]; order: string; limit: number}) => d)
  .handler(async ({data}) => {
    const asked = data.groups.flatMap(({types, filter}) => types.map((type) => ({type, filter})))
    const types = asked.map((a) => a.type)
    // match=any: Sanity ORs the words; Barkpark's default (#23174) keeps only docs with all of them.
    const search = (q: string) => bpJson<{documents: Doc[]}>(`/v1/data/search/${dataset()}?perspective=drafts&match=any&limit=200&q=${encodeURIComponent(q)}&types=${types.map(encodeURIComponent).join(',')}`)
    const q = parseTextQuery(data.q)
    const schemasRead = readSchemas()
    // The preview-reference half (Sanity's $__refIds and the docs that reference them) needs only
    // the query, so it runs beside the main search: typing waits for the slower of the two.
    const viaRead = schemasRead.then((schemas) => previewRefHits(data.q, q, asked, schemas as unknown as Schema[]))
    viaRead.catch(() => {}) // awaited below; a failed main search must not leave it unhandled
    const found = await search(data.q)
    // An id with a dot ("drafts.sq-fox"): Barkpark's search misses some of its docs, so its
    // words are asked too; textScore then matches the id as Sanity does.
    if (data.q.includes('.')) {
      const more = (await search(data.q.replace(/\./g, ' '))).documents.filter((d) => !found.documents.some((f) => f._id === d._id))
      found.documents.push(...more)
    }
    const schemas = await schemasRead
    // Which drafts also have a published version (their published id is searchable too,
    // a draft-only doc's is not: Sanity's id matching). One query per type with drafts.
    const draftTypes = [...new Set(found.documents.filter((d) => d._draft).map((d) => d._type))]
    const marked = new Map((await Promise.all(draftTypes.map((type) => withHasPublished(type, found.documents.filter((d) => d._type === type))))).flat().map((d) => [d._id, d]))
    let hits = found.documents
      .map((d) => marked.get(d._id) ?? d)
      .map((d): Doc => ({...d, _score: textScore(d, q, schemas.find((s) => s.name === d._type) as Schema | undefined)}))
      .filter((d) => (d._score as number) > 0 && types.includes(d._type))
    const kept = await Promise.all(
      asked.map(async ({type, filter}) => {
        const ids = hits.filter((d) => d._type === type).flatMap((d) => [d._id, d._publishedId])
        if (!ids.length || !Object.keys(filter).length) return ids
        if (isGroqFilter(filter)) return (await groqKept(filter, hits.filter((d) => d._type === type))).flatMap((d) => [d._id, d._publishedId])
        const f = `&filter[_id][in]=${[...new Set(ids)].map(encodeURIComponent).join(',')}${refFilterParams(filter)}`
        const r = await bpJson<{result: {documents: Doc[]}}>(`/v1/data/query/${dataset()}/${encodeURIComponent(type)}?perspective=drafts&limit=200${f}`)
        return r.result.documents.flatMap((d) => [d._id, d._publishedId])
      }),
    )
    // Sanity searches each type's preview too (title weight 10, subtitle 5), following
    // references: a post whose author is "Ada Lovelace" is a hit for "Lovelace", and so is
    // any doc that references her elsewhere.
    const {docs: viaRefs, refIds} = await viaRead
    const schemaOf = (d: Doc) => schemas.find((s) => s.name === d._type) as Schema | undefined
    // +5 once for a hit that references a matching target anywhere (a linked post, an author).
    for (const h of hits) h._score = (h._score as number) + refBoost(h, refIds, schemaOf(h))
    for (const d of viaRefs) if (!hits.some((h) => h._id === d._id)) hits.push({...d, _score: 5})
    const extra = viaRefs.filter((d) => !kept.flat().includes(d._id))
    if (extra.length) kept.push(extra.flatMap((d) => [d._id, d._publishedId]))
    const keep = new Set(kept.flat())
    const [key, dir] = data.order.split(':') as [string, string]
    const lengths = new Map(hits.map((d) => [d._id, key === '_score' ? tieLength(d, q, schemaOf(d)) : 0]))
    hits = hits
      .filter((d) => keep.has(d._id))
      // Equal scores: the shorter doc first (Sanity's BM25, lib/text-search), then the dataset's
      // order, oldest first.
      .sort((a, b) => (dir === 'desc' ? -1 : 1) * cmp(a[key], b[key]) || lengths.get(a._id)! - lengths.get(b._id)! || cmp(a._createdAt, b._createdAt) || cmp(a._id, b._id))
    return hits.slice(0, data.limit) as unknown as Json
  })
/**
 * The ids of every preview target that matched (Sanity's `$__refIds`: an author whose name did,
 * a linked post whose title did), and the docs that reference one of them anywhere.
 */
async function previewRefHits(raw: string, q: ReturnType<typeof parseTextQuery>, asked: {type: string; filter: RefFilter}[], schemas: Schema[]): Promise<{docs: Doc[]; refIds: Set<string>}> {
  // Each asked type's preview paths that read through a reference, and the types it points at.
  const via = asked.flatMap(({type}) => {
    const schema = schemas.find((s) => s.name === type)
    // A preview's parts may be objects, fallback lists and templates (lib/preview), not only paths.
    const paths = [...pathsOf(schema?.listPreview?.title), ...pathsOf(schema?.listPreview?.subtitle)]
    return paths.flatMap((path) => {
      const [field, ...rest] = path.split('.')
      const f = schema?.fields.find((x) => x.name === field)
      return rest.length && f?.type === 'reference' ? refTypesOf(f).map((target) => ({target, rest})) : []
    })
  })
  // Array items' previews read through references too (post.links: a docLink shows its target,
  // which reads as the target's own preview title).
  const items = asked.flatMap(({type}) =>
    memberPreviewRefs(schemas.find((s) => s.name === type)?.fields).flatMap((ref) =>
      refTypesOf(ref).map((target) => ({target, rest: ref.leaf.length ? ref.leaf : (pathsOf(schemas.find((s) => s.name === target)?.listPreview?.title)[0] ?? 'title').split('.')})),
    ),
  )
  if (!via.length && !items.length) return {docs: [], refIds: new Set()}
  // One search over every referenced type: a search per type in turn was 50 in a row (2.8 s)
  // on a 64-type model whose previews all read through a reference.
  const targets = [...new Set([...via, ...items].map((v) => v.target))]
  const found = await bpJson<{documents: Doc[]}>(`/v1/data/search/${dataset()}?perspective=drafts&match=any&limit=${Math.min(200, 50 * targets.length)}&q=${encodeURIComponent(raw)}&types=${targets.map(encodeURIComponent).join(',')}`)
  // The referenced doc must match on the previewed field itself.
  const matching = (target: string, rest: string[]) =>
    found.documents
      .filter((d) => d._type === target)
      .map((d) => ({id: d._publishedId as string, score: textScore({title: rest.reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], d)}, q)}))
      .filter((m) => m.score >= 10)
  // The best-matching targets only: a broad word must not send hundreds of ids.
  const best = [...via, ...items].flatMap(({target, rest}) => matching(target, rest)).sort((a, b) => b.score - a.score)
  const refIds = new Set(best.map((m) => m.id).filter((id, i, all) => all.indexOf(id) === i).slice(0, REF_IDS_MAX))
  if (!refIds.size) return {docs: [], refIds}
  // Sanity's `boost(references($__refIds), 5)` makes a hit of every doc that references one of
  // them, in any field (a co-author, a linked post), not only the previewed one: one GROQ read.
  const linked = (await bpJson<{result: {_id: string; _type: string}[]}>(referencingPath(dataset(), [...new Set(asked.map((a) => a.type))], [...refIds]))).result
  const hits = await Promise.all(
    asked.map(async ({type, filter}) => {
      const ids = [...new Set(linked.filter((d) => d._type === type).map((d) => d._id.replace(/^drafts\./, '')))]
      if (!ids.length) return []
      const fq = `&filter[_id][in]=${ids.flatMap((id) => [id, `drafts.${id}`]).map(encodeURIComponent).join(',')}${refFilterParams(filter)}`
      const r = await bpJson<{result: {documents: Doc[]}}>(`/v1/data/query/${dataset()}/${encodeURIComponent(type)}?perspective=drafts&limit=200${fq}`)
      return (await groqKept(filter, r.result.documents)).filter((d) => !excluded(d, q, schemas.find((s) => s.name === type)))
    }),
  )
  return {docs: hits.flat(), refIds}
}
const REF_IDS_MAX = 50
const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : collate(String(a ?? ''), String(b ?? '')))

export const textSearchQuery = (q: string, asked: {type: string; filter: RefFilter}[], order: string, limit: number) =>
  queryOptions({
    queryKey: ['text-search', q, asked, order, limit],
    staleTime: 10_000,
    queryFn: async ({client}) => {
      // The types travel grouped by filter: a {type, filter} each made the GET's URL outgrow
      // the server's header limit on a 64-type model (431: search failed outright).
      const groups = new Map<string, {types: string[]; filter: RefFilter}>()
      for (const {type, filter} of asked) {
        const key = JSON.stringify(filter)
        groups.set(key, {types: [...(groups.get(key)?.types ?? []), type], filter})
      }
      const docs = (await fetchTextSearch({data: {q, groups: [...groups.values()], order, limit}})) as unknown as Doc[]
      for (const d of docs) if (!client.getQueryData(['doc', d._publishedId])) client.setQueryData(['doc', d._publishedId], d)
      return docs
    },
  })

export type Backlink ={from_doc_id: string; type: string; title: string; via_field: string}

const fetchBacklinks = createServerFn({method: 'GET'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    const r = await bpJson<{result: {backlinks: Backlink[]}}>(`/v1/data/backlinks/${dataset()}/${encodeURIComponent(data.id)}`)
    return r.result.backlinks.map(({from_doc_id, type, title, via_field}) => ({from_doc_id, type, title, via_field})) as unknown as Json
  })

/**
 * B07: take every reference to `id` out of the documents that hold one (Barkpark's
 * POST /v1/data/disconnect, LiveView's "Disconnect references and unpublish").
 */
export const disconnectReferences = createServerFn({method: 'POST'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/disconnect/${dataset()}/${encodeURIComponent(data.id)}`, {method: 'POST'})
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {error?: {message?: string}}
      throw new Error(body.error?.message ?? `Barkpark ${res.status}`)
    }
    return null
  })

/** The backlinks of several ids in one read (barkpark#23825); null from a Barkpark without it. */
const fetchBacklinksMany = createServerFn({method: 'GET'})
  .validator((d: {ids: string[]}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/backlinks/${dataset()}?ids=${data.ids.map(encodeURIComponent).join(',')}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Barkpark backlinks → ${res.status}`)
    const r = (await res.json()) as {result: {byId: Record<string, {backlinks: Backlink[]}>}}
    return Object.fromEntries(Object.entries(r.result.byId).map(([id, v]) => [id, v.backlinks.map(({from_doc_id, type, title, via_field}) => ({from_doc_id, type, title, via_field}))])) as unknown as Json
  })

/**
 * `backlinksQuery`'s cache for `ids`, in one read: true when Barkpark answered it, false
 * when it has no batch read (then each id reads alone, as before). Several documents' "used
 * in" (B03's bulk unpublish) was one read per document (task-09a413c1d4d582d3).
 */
export async function ensureBacklinks(client: QueryClient, ids: string[]): Promise<boolean> {
  const byId = (await fetchBacklinksMany({data: {ids}})) as unknown as Record<string, Backlink[]> | null
  if (!byId) return false
  for (const id of ids) client.setQueryData(['backlinks', id], byId[id] ?? [])
  return true
}

/** Documents that reference `id` ("used in"). Barkpark indexes edges a moment after a write. */
export const backlinksQuery = (id: string) =>
  queryOptions({queryKey: ['backlinks', id], staleTime: 5_000, queryFn: async () => (await fetchBacklinks({data: {id}})) as unknown as Backlink[]})

/** Where a server-rendered page resumes its live stream (see server/listen.ts resumeMark). */
export const fetchResumeMark = createServerFn({method: 'GET'}).handler(async () => resumeMark(requestToken()))

/** Last known viewport width (cookie), so the server lays panes out like the client will. */
export const fetchViewportHint = createServerFn({method: 'GET'}).handler(async () => {
  const w = Number(getCookie('bp_vw'))
  return Number.isFinite(w) && w > 0 ? w : 1440
})

export const schemasQuery = queryOptions({queryKey: ['schemas'], queryFn: async () => (await fetchSchemas()) as unknown as Schema[], staleTime: Infinity})

const fetchDesk = createServerFn({method: 'GET'}).handler(async () => (await readDesk()) as Json)
const fetchRest = createServerFn({method: 'GET'}).handler(async () => (await readRest()) as Json)

/** Barkpark's "…Rest" rows: doc types no desk row places (readRest). */
export const restQuery = queryOptions({
  queryKey: ['desk-rest'],
  staleTime: 60_000,
  queryFn: async (): Promise<DeskNode[]> => ((await fetchRest()) as unknown as DeskNode[]).filter((n) => n && (n.type === 'document_type_list' || n.type === 'document')),
})

/** B12: the workspace's declared desk, or null for the plain type list. */
export const deskQuery = queryOptions({
  queryKey: ['desk'],
  staleTime: Infinity,
  queryFn: async (): Promise<DeskNode | null> => {
    const raw = await fetchDesk()
    return raw ? normalizeDesk(raw) : null
  },
})

export const listQuery = (type: string, order: ListOrder = 'updated', limit = LIST_PAGE, filter?: DeskFilter) =>
  queryOptions({
    // The filter goes last and only when set, so ['list', type] still names every list of a type.
    queryKey: filter ? ['list', type, order, limit, filter] : ['list', type, order, limit],
    staleTime: 30_000,
    ...paneRetry,
    queryFn: async ({client}) => {
      const page = (await fetchList({data: {type, order, limit, filter}})) as unknown as ListPage
      // A list row already holds the whole doc: opening it needs no second request.
      for (const d of page.docs) if (!client.getQueryData(['doc', d._publishedId])) client.setQueryData(['doc', d._publishedId], d)
      return page
    },
  })

/** The list as the Published perspective shows it: published versions only. */
export const publishedListQuery = (type: string, order: ListOrder = 'updated', limit = LIST_PAGE, filter?: DeskFilter) =>
  queryOptions({
    queryKey: filter ? ['list-published', type, order, limit, filter] : ['list-published', type, order, limit],
    staleTime: 30_000,
    ...paneRetry,
    queryFn: async ({client}) => {
      const page = (await fetchList({data: {type, published: true, order, limit, filter}})) as unknown as ListPage
      for (const d of page.docs) client.setQueryData(['doc-published', d._publishedId], d)
      return page
    },
  })

export const listSearchQuery = (type: string, q: string) =>
  queryOptions({
    queryKey: ['list-search', type, q],
    staleTime: 10_000,
    queryFn: async ({client}) => {
      const docs = (await fetchListSearch({data: {type, q}})) as unknown as Doc[]
      // Results beyond the loaded list also hold complete documents. Opening
      // one should reuse it, without overwriting a newer local cached edit.
      for (const d of docs) if (!client.getQueryData(['doc', d._publishedId])) client.setQueryData(['doc', d._publishedId], d)
      return docs
    },
  })

/**
 * The editor's unsaved values over a doc read from the server (lib/edits.ts sets it). A
 * read while they wait (a reconnect's re-read, a refetch) put the server's older value
 * on screen: the caret jumped and the next key saved over the lost text (J60 flake).
 */
let withUnsaved = (doc: Doc) => doc
/** The server's doc as it is, without the unsaved values: what a rebase must compare with. */
export const readServerDoc = async (type: string | string[], id: string) => (await fetchDoc({data: {type, id}})) as unknown as Doc | null
export const setUnsavedOverlay = (f: (doc: Doc) => Doc) => void (withUnsaved = f)

export const docQuery = (type: string | string[], id: string) =>
  queryOptions({
    queryKey: ['doc', id],
    staleTime: 30_000,
    ...paneRetry,
    queryFn: async () => {
      const doc = (await fetchDoc({data: {type, id}})) as unknown as Doc | null
      return doc && withUnsaved(doc)
    },
  })

export const searchQuery = (type: string | string[], q: string, filter?: RefFilter, order?: string, limit?: number) =>
  queryOptions({
    queryKey: ['search', [type].flat().join(','), q, filter, order, limit],
    staleTime: 10_000,
    queryFn: async ({client}) => {
      const types = [type].flat()
      const found = (await Promise.all(types.map((t) => fetchSearch({data: {type: t, q, filter, order, limit}})))).flat() as unknown as Doc[]
      const docs = types.length > 1 ? found.sort((a, b) => b._updatedAt.localeCompare(a._updatedAt)).slice(0, limit ?? 20) : found
      for (const d of docs) if (!client.getQueryData(['doc', d._publishedId])) client.setQueryData(['doc', d._publishedId], d)
      return docs
    },
  })

/** D06: a doc by its id alone, whatever its type (a wikilink names only the id); null if none. */
const fetchDocAnyType = createServerFn({method: 'GET'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    // One read names its type, one reads it. A read per schema type was 64 at once for a
    // 64-type model, and 3.8 s to say an id is not there.
    const [type, schemas] = await Promise.all([typesOf([data.id]).then((t) => t[data.id]), readSchemas()])
    if (!type || !schemas.some((s) => s.name === type)) return null
    const res = await bpFetch(`/v1/data/doc/${dataset()}/${encodeURIComponent(type)}/${encodeURIComponent(data.id)}?perspective=drafts`)
    return res.ok ? ((await res.json()) as {result: Json}).result : null
  })
export const anyDocQuery = (id: string) =>
  queryOptions({queryKey: ['doc-any', id], staleTime: 30_000, queryFn: async () => (await fetchDocAnyType({data: {id}})) as unknown as (Doc & {preview?: {description?: string}}) | null})

/**
 * A document a preview path crosses, as loaded: a typed read (`docQuery`, kept live)
 * first, then `anyDocQuery`'s. Undefined while neither has it.
 */
export const cachedDoc = (qc: QueryClient) => (id: string) => qc.getQueryData(['doc', id]) ?? qc.getQueryData(anyDocQuery(id).queryKey)

/** D06: docs of any type matching `q` (the canvas's `[[` menu), newest first. */
const fetchSearchAll = createServerFn({method: 'GET'})
  .validator((d: {q: string}) => d)
  .handler(async ({data}) => {
    const r = await bpJson<{documents: Doc[]}>(`/v1/data/search/${dataset()}?q=${encodeURIComponent(data.q)}&limit=10&perspective=drafts`)
    return r.documents.filter((d) => !STUDIO_TYPES.includes(d._type)) as unknown as Json
  })
export const searchAllDocs = async (q: string) => (await fetchSearchAll({data: {q}})) as unknown as Doc[]

export const schemaOf = (schemas: Schema[], type: string) => schemas.find((s) => s.name === type)
/** B13: a singleton type has one document, whose id is the type's name (Barkpark's rule): no list, no create, duplicate, delete or unpublish. */
export const isSingleton = (schemas: Schema[], type: string) => schemaOf(schemas, type)?.singleton === true

/** The types a reference field (or a reference array's member) may point to. */
export {itemPath, refId} from './refs'
export const refTypesOf = (field: Field | undefined): string[] => field?.to?.map((t) => t.type) ?? (field?.refType ? [field.refType] : [])

/** The types with a reference field (at any depth, in arrays too) that can point at `type`: who can refer to it. */
export function referringTypes(schemas: Schema[], type: string): string[] {
  const points = (fields: Field[] | undefined): boolean =>
    (fields ?? []).some((f) => refTypesOf(f).includes(type) || refTypesOf(f.of).includes(type) || points(f.fields) || points(f.of?.fields))
  return schemas.filter((s) => points(s.fields)).map((s) => s.name)
}

/**
 * Preview title per Sanity's rules: list_preview.title, else title/name. Without one,
 * the placeholder: 'Untitled', or with `t` in the editor's language (anything shown
 * or announced passes it; sorting and matching don't).
 */
export function previewTitle(doc: Doc | null | undefined, schema?: Schema, t?: T): string {
  const none = t ? t('Untitled') : 'Untitled'
  if (!doc) return none
  const key = schema?.listPreview?.title
  const v = (key && doc[key]) ?? doc.title ?? doc.name
  return typeof v === 'string' && v ? v : none
}

export type {QueryClient}

/**
 * Sanity names a new untitled doc "New <Type>" in its own pane until it exists (its first
 * edit saves a draft); anything else untitled, a draft too, is "Untitled". `t`: the
 * render's translate (English when not given).
 */
export const docTitle = (doc: Doc, schema: Schema, t: T = (en, vars) => translate('en', en, vars)) => {
  const title = previewTitle(doc, schema)
  if (title !== 'Untitled') return title
  // A singleton without a title field is named by its type, as Sanity's fixed
  // preview titles do ("Forside", "Nettstedsinnstillinger").
  if (schema.singleton) return schema.title
  return !doc._rev ? t('New {type}', {type: schema.title}) : t('Untitled')
}
