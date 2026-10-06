import {queryOptions, type QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {getCookie} from '@tanstack/react-start/server'
import {bpFetch, dataset} from '../server/barkpark'
import {readSchemas} from '../server/schemas'
import type {Condition} from './conditions'

// Every read the studio does. Server functions: on the server they call Barkpark
// directly (SSR), in the browser they are same-origin RPC — the token never leaves.

// `_hasPublished` is ours, not Barkpark's: the drafts perspective can't tell a
// draft of a published doc from a brand-new draft, so reads ask both perspectives.
export type Doc = {_id: string; _publishedId: string; _type: string; _draft: boolean; _rev: string; _updatedAt: string; _hasPublished?: boolean} & Record<
  string,
  unknown
>
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
  validation?: {required?: boolean; min?: number; max?: number}
  /** localizedText (B04/B06): the languages it holds. */
  languages?: string[]
  /** codelist (B04/B05): `<plugin>:<name>`. */
  codelistId?: string
  /** Array item preview: which subfields title and subtitle a row (J33). */
  preview?: {title?: string; subtitle?: string}
  visibleWhen?: Condition
  readOnly?: boolean | Condition
}
export type Group = {name: string; title?: string; default?: boolean}
export type Schema = {name: string; title: string; fields: Field[]; listPreview?: Record<string, string>; groups?: Group[]; initialValues?: Record<string, unknown>}

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
    .map(({name, title, fields, listPreview, list_preview, groups, initialValues, initial_values}) => ({name, title, fields, listPreview: listPreview ?? list_preview, groups: groups ?? [], initialValues: initialValues ?? initial_values ?? {}})) as unknown as Json
})

// J41, Sanity's paging: a list opens with its first LIST_PAGE rows and loads up to
// LIST_MAX when you scroll near the end; past that it says so. Order is the server's.
export const LIST_PAGE = 100
export const LIST_MAX = 2000
export type ListOrder = 'updated' | 'created' | 'title'
const ORDER: Record<ListOrder, string> = {updated: '_updatedAt:desc', created: '_createdAt:desc', title: 'title:asc'}
/** One loaded list: its rows, and whether the server holds more. */
export type ListPage = {docs: Doc[]; hasMore: boolean}

const fetchList = createServerFn({method: 'GET'})
  .validator((d: {type: string; published?: boolean; limit?: number; order?: ListOrder}) => d)
  .handler(async ({data}) => {
    const limit = Math.min(data.limit ?? LIST_PAGE, LIST_MAX)
    const docs: Doc[] = []
    let hasMore = true
    // Barkpark serves at most 1000 rows a request.
    while (hasMore && docs.length < limit) {
      const r = await bpJson<{result: {documents: Doc[]; hasMore: boolean}}>(
        `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?order=${ORDER[data.order ?? 'updated']}&limit=${Math.min(limit - docs.length, 1000)}&offset=${docs.length}&perspective=${data.published ? 'published' : 'drafts'}`,
      )
      docs.push(...r.result.documents)
      hasMore = r.result.hasMore
    }
    const out = data.published ? docs.map((d) => ({...d, _hasPublished: true})) : await withHasPublished(data.type, docs)
    return {docs: out, hasMore} as unknown as Json
  })

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
  queryOptions({queryKey: ['doc-published', id], staleTime: 30_000, queryFn: async () => (await fetchPublished({data: {type, id}})) as unknown as Doc | null})

/**
 * Mark which docs have a published version. A row read through the drafts
 * perspective that is not a draft is published; only drafts need asking, in one
 * query for the lot.
 */
async function withHasPublished(type: string, docs: Doc[]): Promise<Doc[]> {
  const drafts = docs.filter((d) => d._draft).map((d) => d._publishedId)
  let live = new Set<string>()
  if (drafts.length) {
    const ids = drafts.map(encodeURIComponent).join(',')
    const r = await bpJson<{result: {documents: Doc[]}}>(
      `/v1/data/query/${dataset()}/${encodeURIComponent(type)}?perspective=published&limit=200&filter[_id][in]=${ids}`,
    )
    live = new Set(r.result.documents.map((d) => d._id))
  }
  return docs.map((d) => ({...d, _hasPublished: !d._draft || live.has(d._publishedId)}))
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

/** A reference field's filter, in Barkpark's query terms: {field: {op: value}}. */
export type RefFilter = Record<string, Record<string, string>>

const fetchSearch = createServerFn({method: 'GET'})
  .validator((d: {type: string; q: string; filter?: RefFilter}) => d)
  .handler(async ({data}) => {
    // `contains` is case-insensitive; `title` is the row's preview title for every type.
    let filter = data.q ? `&filter[title][contains]=${encodeURIComponent(data.q)}` : ''
    for (const [field, ops] of Object.entries(data.filter ?? {}))
      for (const [op, v] of Object.entries(ops)) filter += `&filter[${encodeURIComponent(field)}][${encodeURIComponent(op)}]=${encodeURIComponent(v)}`
    const r = await bpJson<{result: {documents: Doc[]}}>(
      `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?perspective=drafts&order=_updatedAt:desc&limit=20${filter}`,
    )
    return r.result.documents as unknown as Json
  })

export type Backlink = {from_doc_id: string; type: string; title: string; via_field: string}

const fetchBacklinks = createServerFn({method: 'GET'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    const r = await bpJson<{result: {backlinks: Backlink[]}}>(`/v1/data/backlinks/${dataset()}/${encodeURIComponent(data.id)}`)
    return r.result.backlinks.map(({from_doc_id, type, title, via_field}) => ({from_doc_id, type, title, via_field})) as unknown as Json
  })

/** Documents that reference `id` ("used in"). Barkpark indexes edges a moment after a write. */
export const backlinksQuery = (id: string) =>
  queryOptions({queryKey: ['backlinks', id], staleTime: 5_000, queryFn: async () => (await fetchBacklinks({data: {id}})) as unknown as Backlink[]})

/** Last known viewport width (cookie), so the server lays panes out like the client will. */
export const fetchViewportHint = createServerFn({method: 'GET'}).handler(async () => {
  const w = Number(getCookie('bp_vw'))
  return Number.isFinite(w) && w > 0 ? w : 1440
})

export const schemasQuery = queryOptions({queryKey: ['schemas'], queryFn: async () => (await fetchSchemas()) as unknown as Schema[], staleTime: Infinity})

export const listQuery = (type: string, order: ListOrder = 'updated', limit = LIST_PAGE) =>
  queryOptions({
    queryKey: ['list', type, order, limit],
    staleTime: 30_000,
    queryFn: async ({client}) => {
      const page = (await fetchList({data: {type, order, limit}})) as unknown as ListPage
      // A list row already holds the whole doc: opening it needs no second request.
      for (const d of page.docs) if (!client.getQueryData(['doc', d._publishedId])) client.setQueryData(['doc', d._publishedId], d)
      return page
    },
  })

/** The list as the Published perspective shows it: published versions only. */
export const publishedListQuery = (type: string, order: ListOrder = 'updated', limit = LIST_PAGE) =>
  queryOptions({
    queryKey: ['list-published', type, order, limit],
    staleTime: 30_000,
    queryFn: async ({client}) => {
      const page = (await fetchList({data: {type, published: true, order, limit}})) as unknown as ListPage
      for (const d of page.docs) client.setQueryData(['doc-published', d._publishedId], d)
      return page
    },
  })

export const listSearchQuery = (type: string, q: string) =>
  queryOptions({queryKey: ['list-search', type, q], staleTime: 10_000, queryFn: async () => (await fetchListSearch({data: {type, q}})) as unknown as Doc[]})

export const docQuery = (type: string | string[], id: string) =>
  queryOptions({queryKey: ['doc', id], staleTime: 30_000, queryFn: async () => (await fetchDoc({data: {type, id}})) as unknown as Doc | null})

export const searchQuery = (type: string | string[], q: string, filter?: RefFilter) =>
  queryOptions({
    queryKey: ['search', [type].flat().join(','), q, filter],
    staleTime: 10_000,
    queryFn: async ({client}) => {
      const types = [type].flat()
      const found = (await Promise.all(types.map((t) => fetchSearch({data: {type: t, q, filter}})))).flat() as unknown as Doc[]
      const docs = types.length > 1 ? found.sort((a, b) => b._updatedAt.localeCompare(a._updatedAt)).slice(0, 20) : found
      for (const d of docs) if (!client.getQueryData(['doc', d._publishedId])) client.setQueryData(['doc', d._publishedId], d)
      return docs
    },
  })

export const schemaOf = (schemas: Schema[], type: string) => schemas.find((s) => s.name === type)

/** The types a reference field (or a reference array's member) may point to. */
/** A reference value: a bare id, or a keyed array item {_key, _type: 'reference', _ref} (task-fb4c4703cc92b32e). */
export const refId = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof (v as {_ref?: unknown})?._ref === 'string' ? (v as {_ref: string})._ref : undefined)
/** An array item's path: by _key when it has one (Sanity's `categories[_key=="c2"]`), else by index. */
export const itemPath = (path: string, item: unknown, i: number) => {
  const key = (item as {_key?: unknown})?._key
  return typeof key === 'string' ? `${path}[_key=="${key}"]` : `${path}[${i}]`
}
export const refTypesOf = (field: Field | undefined): string[] => field?.to?.map((t) => t.type) ?? (field?.refType ? [field.refType] : [])

/** Preview title per Sanity's rules: list_preview.title, else title/name. */
export function previewTitle(doc: Doc | null | undefined, schema?: Schema): string {
  if (!doc) return 'Untitled'
  const key = schema?.listPreview?.title
  const v = (key && doc[key]) ?? doc.title ?? doc.name
  return typeof v === 'string' && v ? v : 'Untitled'
}

export type {QueryClient}
