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
  rows?: number
  of?: Field
  fields?: Field[]
  options?: Record<string, unknown>
  group?: string
  validation?: {required?: boolean; min?: number; max?: number}
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

const fetchList = createServerFn({method: 'GET'})
  .validator((d: {type: string; published?: boolean}) => d)
  .handler(async ({data}) => {
    const r = await bpJson<{result: {documents: Doc[]}}>(
      `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?order=_updatedAt:desc&limit=200&perspective=${data.published ? 'published' : 'drafts'}`,
    )
    if (data.published) return r.result.documents.map((d) => ({...d, _hasPublished: true})) as unknown as Json
    return (await withHasPublished(data.type, r.result.documents)) as unknown as Json
  })

const fetchDoc = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string}) => d)
  .handler(async ({data}) => {
    const path = `/v1/data/doc/${dataset()}/${encodeURIComponent(data.type)}/${encodeURIComponent(data.id)}?perspective=drafts`
    const res = await bpFetch(path)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Barkpark ${path} → ${res.status}`)
    const [doc] = await withHasPublished(data.type, [((await res.json()) as {result: Doc}).result])
    return doc as unknown as Json
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
    const ids = data.ids.map(encodeURIComponent).join(',')
    const r = await bpJson<{result: {documents: Doc[]}}>(
      `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?perspective=drafts&limit=200&filter[_id][in]=${ids}`,
    )
    return (await withHasPublished(data.type, r.result.documents)) as unknown as Json
  })

/** Put any of `ids` not already cached into the cache, with one request per call. */
export async function ensureDocs(client: QueryClient, type: string, ids: string[]) {
  const missing = [...new Set(ids)].filter((id) => client.getQueryData(['doc', id]) === undefined)
  if (!missing.length) return
  const docs = (await fetchMany({data: {type, ids: missing}})) as unknown as Doc[]
  for (const d of docs) client.setQueryData(['doc', d._publishedId], d)
  for (const id of missing) if (client.getQueryData(['doc', id]) === undefined) client.setQueryData(['doc', id], null)
}

const fetchSearch = createServerFn({method: 'GET'})
  .validator((d: {type: string; q: string}) => d)
  .handler(async ({data}) => {
    // `contains` is case-insensitive; `title` is the row's preview title for every type.
    const filter = data.q ? `&filter[title][contains]=${encodeURIComponent(data.q)}` : ''
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

export const listQuery = (type: string) =>
  queryOptions({
    queryKey: ['list', type],
    staleTime: 30_000,
    queryFn: async ({client}) => {
      const docs = (await fetchList({data: {type}})) as unknown as Doc[]
      // A list row already holds the whole doc: opening it needs no second request.
      for (const d of docs) client.setQueryData(['doc', d._publishedId], d)
      return docs
    },
  })

/** The list as the Published perspective shows it: published versions only. */
export const publishedListQuery = (type: string) =>
  queryOptions({
    queryKey: ['list-published', type],
    staleTime: 30_000,
    queryFn: async ({client}) => {
      const docs = (await fetchList({data: {type, published: true}})) as unknown as Doc[]
      for (const d of docs) client.setQueryData(['doc-published', d._publishedId], d)
      return docs
    },
  })

export const docQuery = (type: string, id: string) =>
  queryOptions({queryKey: ['doc', id], staleTime: 30_000, queryFn: async () => (await fetchDoc({data: {type, id}})) as unknown as Doc | null})

export const searchQuery = (type: string, q: string) =>
  queryOptions({
    queryKey: ['search', type, q],
    staleTime: 10_000,
    queryFn: async ({client}) => {
      const docs = (await fetchSearch({data: {type, q}})) as unknown as Doc[]
      for (const d of docs) if (!client.getQueryData(['doc', d._publishedId])) client.setQueryData(['doc', d._publishedId], d)
      return docs
    },
  })

export const schemaOf = (schemas: Schema[], type: string) => schemas.find((s) => s.name === type)

/** Preview title per Sanity's rules: list_preview.title, else title/name. */
export function previewTitle(doc: Doc | null | undefined, schema?: Schema): string {
  if (!doc) return 'Untitled'
  const key = schema?.listPreview?.title
  const v = (key && doc[key]) ?? doc.title ?? doc.name
  return typeof v === 'string' && v ? v : 'Untitled'
}

export type {QueryClient}
