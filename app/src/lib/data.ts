import {queryOptions, type QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {getCookie} from '@tanstack/react-start/server'
import {bpFetch, dataset} from '../server/barkpark'

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
}
export type Schema = {name: string; title: string; fields: Field[]; listPreview?: Record<string, string>}

// Server functions return plain JSON; the typed views below cast it once.
type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

async function bpJson<T>(path: string): Promise<T> {
  const res = await bpFetch(path)
  if (!res.ok) throw new Error(`Barkpark ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

const fetchSchemas = createServerFn({method: 'GET'}).handler(async () => {
  const r = await bpJson<{schemas: Schema[]}>(`/v1/schemas/${dataset()}`)
  return r.schemas.map(({name, title, fields, listPreview}) => ({name, title, fields, listPreview})) as unknown as Json
})

const fetchList = createServerFn({method: 'GET'})
  .validator((d: {type: string}) => d)
  .handler(async ({data}) => {
    const base = `/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?order=_updatedAt:desc&limit=200`
    const [drafts, published] = await Promise.all([
      bpJson<{result: {documents: Doc[]}}>(`${base}&perspective=drafts`),
      bpJson<{result: {documents: Doc[]}}>(`${base}&perspective=published&fields=_id`),
    ])
    const live = new Set(published.result.documents.map((d) => d._id))
    return drafts.result.documents.map((d) => ({...d, _hasPublished: live.has(d._publishedId)})) as unknown as Json
  })

const fetchDoc = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string}) => d)
  .handler(async ({data}) => {
    const path = `/v1/data/doc/${dataset()}/${encodeURIComponent(data.type)}/${encodeURIComponent(data.id)}?perspective=`
    const [res, pub] = await Promise.all([bpFetch(path + 'drafts'), bpFetch(path + 'published')])
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Barkpark ${path}drafts → ${res.status}`)
    const doc = ((await res.json()) as {result: Record<string, Json>}).result
    return {...doc, _hasPublished: pub.ok} as Json
  })

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
