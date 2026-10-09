import {queryOptions, type QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {getCookie} from '@tanstack/react-start/server'
import {bpFetch, dataset, requestToken} from '../server/barkpark'
import {resumeMark} from '../server/listen'
import {readDesk, readSchemas} from '../server/schemas'
import type {Condition} from './conditions'
import {paneRetry} from './connection'
import type {T} from './i18n'
import {normalizeDesk, type DeskFilter, type DeskNode} from './desk'
import type {Sort} from './list-prefs'
import type {PreviewText} from './preview'
import {excluded, parseTextQuery, textScore} from './text-search'

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
export type Rule = {required?: boolean; min?: number; max?: number; level?: string; message?: string}

export type Field = {
  name: string
  title?: string
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
  /** Array item preview: which subfields title and subtitle a row (J33). */
  preview?: {title?: string; subtitle?: string}
  visibleWhen?: Condition
  readOnly?: boolean | Condition
}
export type Group = {name: string; title?: string; default?: boolean}
/** J55: a type's own sort, Sanity's `orderings` (Barkpark: the schema's `desk.orderings`). */
export type Ordering = {name: string; title: string; by: {field: string; direction: 'asc' | 'desc'}[]}
/** A row's preview: title and media name fields; the subtitle may be prepared (J56, lib/preview.ts). */
export type ListPreview = {title?: string; subtitle?: PreviewText; media?: string}
/** One entry of a type's Expectation (Barkpark's `layout`): a bound field block, or the free region. */
export type LayoutItem = {kind: 'field' | 'region' | string; name: string; max?: number; enforce?: boolean}
export type Schema = {name: string; title: string; fields: Field[]; listPreview?: ListPreview; groups?: Group[]; initialValues?: Record<string, unknown>; orderings?: Ordering[]; singleton?: boolean; views?: DeskView[]; preview?: string; layout?: LayoutItem[]; prefill?: Record<string, unknown>}
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

const fetchSchemas = createServerFn({method: 'GET'}).handler(async () => {
  const schemas = await readSchemas()
  return schemas
    .map(({name, title, fields, listPreview, list_preview, groups, initialValues, initial_values, desk, singleton, layout, prefill}) => ({
      name, title, fields, listPreview: listPreview ?? list_preview, groups: groups ?? [], initialValues: initialValues ?? initial_values ?? {},
      layout: Array.isArray(layout) ? layout : [], prefill: prefill ?? {},
      singleton: singleton === true,
      orderings: ((desk as {orderings?: RawOrdering[]} | undefined)?.orderings ?? []).filter((o) => o.field || o.by?.length).map(ordering),
      views: ((desk as {views?: Json[]} | undefined)?.views ?? []) as Json[],
      // The type's preview URL template (desk.preview), for the Preview view; absent → no view.
      ...(typeof (desk as {preview?: unknown} | undefined)?.preview === 'string' ? {preview: (desk as {preview: string}).preview} : {}),
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
export type ListPage = {docs: Doc[]; hasMore: boolean}

/** A desk list's filter as query parameters (B12): `is: null` and the other ops pass through as Barkpark reads them. */
const filterParams = (filter?: DeskFilter) =>
  Object.entries(filter ?? {})
    .flatMap(([field, ops]) => Object.entries(ops).map(([op, v]) => `&filter[${encodeURIComponent(field)}][${encodeURIComponent(op)}]=${encodeURIComponent(String(v))}`))
    .join('')

const fetchList = createServerFn({method: 'GET'})
  .validator((d: {type: string; published?: boolean; limit?: number; order?: ListOrder; filter?: DeskFilter}) => d)
  .handler(async ({data}) => {
    const limit = Math.min(data.limit ?? LIST_PAGE, LIST_MAX)
    const docs: Doc[] = []
    let hasMore = true
    // Barkpark serves at most 1000 rows a request.
    while (hasMore && docs.length < limit) {
      const r = await bpJson<{result: {documents: Doc[]; hasMore: boolean}}>(
        `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?order=${orderParam(data.order)}&limit=${Math.min(limit - docs.length, 1000)}&offset=${docs.length}&perspective=${data.published ? 'published' : 'drafts'}${filterParams(data.filter)}`,
      )
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
    // Barkpark matches ANY word, newest first; the list wants docs with EVERY word (the
    // pane filters for that). So search the rarest word: its matches hold them all.
    const terms = data.q.split(/\s+/).filter(Boolean)
    let best = terms[0] ?? ''
    if (terms.length > 1) {
      const counts = await Promise.all(terms.map((t) => search(t, 1).then((r) => r.count)))
      best = terms[counts.indexOf(Math.min(...counts))]!
    }
    const r = await search(best, LIST_PAGE)
    return (await withHasPublished(data.type, r.documents)) as unknown as Json
  })

// A reference with several target types names them all; the doc is whichever has the id.
const fetchDoc = createServerFn({method: 'GET'})
  .validator((d: {type: string | string[]; id: string}) => d)
  .handler(async ({data}) => {
    for (const type of [data.type].flat()) {
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

/** A reference field's filter, in Barkpark's query terms: {field: {op: value}}; op '' is `filter[field]=value` (`_references`). */
export type RefFilter = Record<string, Record<string, string>>
const refFilterParams = (filter: RefFilter | undefined) =>
  Object.entries(filter ?? {})
    .flatMap(([field, ops]) => Object.entries(ops).map(([op, v]) => `&filter[${encodeURIComponent(field)}]${op ? `[${encodeURIComponent(op)}]` : ''}=${encodeURIComponent(v)}`))
    .join('')

const fetchSearch = createServerFn({method: 'GET'})
  .validator((d: {type: string; q: string; filter?: RefFilter; order?: string; limit?: number}) => d)
  .handler(async ({data}) => {
    // `contains` is case-insensitive; `title` is the row's preview title for every type.
    // `order` (J38): `_updatedAt:desc` (default) or `_createdAt:desc`.
    const filter = (data.q ? `&filter[title][contains]=${encodeURIComponent(data.q)}` : '') + refFilterParams(data.filter)
    const r = await bpJson<{result: {documents: Doc[]}}>(
      `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?perspective=drafts&order=${encodeURIComponent(data.order ?? '_updatedAt:desc')}&limit=${Math.min(data.limit ?? 20, 100)}${filter}`,
    )
    return r.result.documents as unknown as Json
  })

/**
 * J38: global search over every text field, Sanity's way. Barkpark's search
 * (title + every content string) finds the candidates; each type's query then
 * narrows them by its field filters, so those keep Barkpark's own semantics;
 * textScore keeps the hits Sanity would show and scores them. The best `limit`
 * by `order` (`_score:desc` is best match) come back with `_score` set.
 */
const fetchTextSearch = createServerFn({method: 'GET'})
  .validator((d: {q: string; asked: {type: string; filter: RefFilter}[]; order: string; limit: number}) => d)
  .handler(async ({data}) => {
    const types = data.asked.map((a) => a.type)
    const found = await bpJson<{documents: Doc[]}>(
      `/v1/data/search/${dataset()}?perspective=drafts&limit=200&q=${encodeURIComponent(data.q)}&types=${types.map(encodeURIComponent).join(',')}`,
    )
    const schemas = await readSchemas()
    const q = parseTextQuery(data.q)
    let hits = found.documents
      .map((d): Doc => ({...d, _score: textScore(d, q, schemas.find((s) => s.name === d._type) as Schema | undefined)}))
      .filter((d) => (d._score as number) > 0 && types.includes(d._type))
    const kept = await Promise.all(
      data.asked.map(async ({type, filter}) => {
        const ids = hits.filter((d) => d._type === type).flatMap((d) => [d._id, d._publishedId])
        if (!ids.length || !Object.keys(filter).length) return ids
        const f = `&filter[_id][in]=${[...new Set(ids)].map(encodeURIComponent).join(',')}${refFilterParams(filter)}`
        const r = await bpJson<{result: {documents: Doc[]}}>(`/v1/data/query/${dataset()}/${encodeURIComponent(type)}?perspective=drafts&limit=200${f}`)
        return r.result.documents.flatMap((d) => [d._id, d._publishedId])
      }),
    )
    // Sanity searches each type's preview too (title weight 10, subtitle 5), following
    // references: a post whose author is "Ada Lovelace" is a hit for "Lovelace".
    const viaRefs = await previewRefHits(data.q, q, data.asked, schemas as unknown as Schema[])
    for (const d of viaRefs) {
      const had = hits.find((h) => h._id === d._id)
      if (had) had._score = (had._score as number) + 5
      else hits.push({...d, _score: 5})
    }
    const extra = viaRefs.filter((d) => !kept.flat().includes(d._id))
    if (extra.length) kept.push(extra.flatMap((d) => [d._id, d._publishedId]))
    const keep = new Set(kept.flat())
    const [key, dir] = data.order.split(':') as [string, string]
    hits = hits
      .filter((d) => keep.has(d._id))
      // Ties stay in the dataset's order, oldest first (Sanity's, for equal scores).
      .sort((a, b) => (dir === 'desc' ? -1 : 1) * cmp(a[key], b[key]) || cmp(a._createdAt, b._createdAt) || cmp(a._id, b._id))
    return hits.slice(0, data.limit) as unknown as Json
  })
/** The docs that match through a reference in their preview (`subtitle: 'author.name'`). */
async function previewRefHits(raw: string, q: ReturnType<typeof parseTextQuery>, asked: {type: string; filter: RefFilter}[], schemas: Schema[]): Promise<Doc[]> {
  const out: Doc[] = []
  for (const {type, filter} of asked) {
    const schema = schemas.find((s) => s.name === type)
    const sub = schema?.listPreview?.subtitle
    const paths = [schema?.listPreview?.title, ...(typeof sub === 'string' ? [sub] : (sub as {parts?: string[]} | undefined)?.parts ?? [])]
    for (const path of paths) {
      const [field, ...rest] = (path ?? '').split('|')[0]!.split('.')
      const f = schema?.fields.find((x) => x.name === field)
      if (!rest.length || f?.type !== 'reference') continue
      for (const target of refTypesOf(f)) {
        const found = await bpJson<{documents: Doc[]}>(`/v1/data/search/${dataset()}?perspective=drafts&limit=50&q=${encodeURIComponent(raw)}&types=${encodeURIComponent(target)}`)
        // The referenced doc must match on the previewed field itself.
        const ids = found.documents.filter((d) => textScore({title: rest.reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], d)}, q) >= 10).map((d) => d._publishedId)
        if (!ids.length) continue
        const fq = `&filter[${encodeURIComponent(field!)}][in]=${ids.map(encodeURIComponent).join(',')}${refFilterParams(filter)}`
        const r = await bpJson<{result: {documents: Doc[]}}>(`/v1/data/query/${dataset()}/${encodeURIComponent(type)}?perspective=drafts&limit=200${fq}`)
        out.push(...r.result.documents.filter((d) => !excluded(d, q, schema)))
      }
    }
  }
  return out
}
const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')))

export const textSearchQuery = (q: string, asked: {type: string; filter: RefFilter}[], order: string, limit: number) =>
  queryOptions({
    queryKey: ['text-search', q, asked, order, limit],
    staleTime: 10_000,
    queryFn: async ({client}) => {
      const docs = (await fetchTextSearch({data: {q, asked, order, limit}})) as unknown as Doc[]
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

export const docQuery = (type: string | string[], id: string) =>
  queryOptions({queryKey: ['doc', id], staleTime: 30_000, ...paneRetry, queryFn: async () => (await fetchDoc({data: {type, id}})) as unknown as Doc | null})

export const searchQuery = (type: string | string[], q: string, filter?: RefFilter, order?: string, limit?: number) =>
  queryOptions({
    queryKey: ['search', [type].flat().join(','), q, filter, order, limit],
    staleTime: 10_000,
    queryFn: async ({client}) => {
      const types = [type].flat()
      const found = (await Promise.all(types.map((t) => fetchSearch({data: {type: t, q, filter, order, limit}})))).flat() as unknown as Doc[]
      const docs = types.length > 1 ? found.sort((a, b) => b._updatedAt.localeCompare(a._updatedAt)).slice(0, 20) : found
      for (const d of docs) if (!client.getQueryData(['doc', d._publishedId])) client.setQueryData(['doc', d._publishedId], d)
      return docs
    },
  })

/** D06: a doc by its id alone, whatever its type (a wikilink names only the id); null if none. */
const fetchDocAnyType = createServerFn({method: 'GET'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    const types = (await readSchemas()).map((s) => s.name)
    const hits = await Promise.all(
      types.map(async (type) => {
        const res = await bpFetch(`/v1/data/doc/${dataset()}/${encodeURIComponent(type)}/${encodeURIComponent(data.id)}?perspective=drafts`)
        return res.ok ? ((await res.json()) as {result: Json}).result : null
      }),
    )
    return hits.find(Boolean) ?? null
  })
export const anyDocQuery = (id: string) =>
  queryOptions({queryKey: ['doc-any', id], staleTime: 30_000, queryFn: async () => (await fetchDocAnyType({data: {id}})) as unknown as (Doc & {preview?: {description?: string}}) | null})

/** D06: docs of any type matching `q` (the canvas's `[[` menu), newest first. */
const fetchSearchAll = createServerFn({method: 'GET'})
  .validator((d: {q: string}) => d)
  .handler(async ({data}) => {
    const r = await bpJson<{documents: Doc[]}>(`/v1/data/search/${dataset()}?q=${encodeURIComponent(data.q)}&limit=10&perspective=drafts`)
    return r.documents as unknown as Json
  })
export const searchAllDocs = async (q: string) => (await fetchSearchAll({data: {q}})) as unknown as Doc[]

export const schemaOf = (schemas: Schema[], type: string) => schemas.find((s) => s.name === type)
/** B13: a singleton type has one document, whose id is the type's name (Barkpark's rule): no list, no create, duplicate, delete or unpublish. */
export const isSingleton = (schemas: Schema[], type: string) => schemaOf(schemas, type)?.singleton === true

/** The types a reference field (or a reference array's member) may point to. */
/** A reference value: a bare id, or a keyed array item {_key, _type: 'reference', _ref} (task-fb4c4703cc92b32e). */
export const refId = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof (v as {_ref?: unknown})?._ref === 'string' ? (v as {_ref: string})._ref : undefined)
/** An array item's path: by _key when it has one (Sanity's `categories[_key=="c2"]`), else by index. */
export const itemPath = (path: string, item: unknown, i: number) => {
  const key = (item as {_key?: unknown})?._key
  return typeof key === 'string' ? `${path}[_key=="${key}"]` : `${path}[${i}]`
}
export const refTypesOf = (field: Field | undefined): string[] => field?.to?.map((t) => t.type) ?? (field?.refType ? [field.refType] : [])

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
