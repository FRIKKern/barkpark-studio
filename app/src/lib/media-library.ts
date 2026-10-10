import {createServerFn} from '@tanstack/react-start'
import {queryOptions} from '@tanstack/react-query'
import {bpFetch, dataset} from '../server/barkpark'

// B08: the Media tool, after Barkpark's LiveView media library (its bp-asset-explorer
// web component): folders (collections), a visibility filter, and the checkout lock
// that guards an asset's metadata. Every call goes as the signed-in editor, so the
// lock's holder is "you" for the one who checked it out.

export type Visibility = 'public' | 'private'
export type LibraryAsset = {id: string; name: string; mimeType: string; size: number; visibility?: Visibility; createdAt: string; checkedOutBy?: string | null}
export type Collection = {id: string; title: string; kind: string}
export type AssetDetail = LibraryAsset & {
  /** The mediaAsset document holding the editable metadata (title, alt text). */
  docId: string
  title?: string
  altText?: string
  /** null: free; "you": held by whoever is asking; else the holder's name. */
  checkoutLabel: string | null
  checkedOutAt?: string
  canEdit: boolean
  visibilityNotice?: {label: string; copy: string}
}

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}
type RawAsset = {
  id: string
  size?: number
  filename?: string
  originalName?: string
  mimeType?: string
  visibility?: Visibility
  createdAt?: string
  assetDocId?: string
  permissions?: string[]
  checkoutLabel?: string | null
  visibilityNotice?: {label: string; copy: string}
  asset?: {_id?: string; title?: string; altText?: string; checkedOutBy?: string | null; checkedOutAt?: string; fileInfo?: {mimeType?: string; originalName?: string}}
}
const toAsset = (a: RawAsset): LibraryAsset => ({
  id: a.id,
  name: a.originalName || a.asset?.fileInfo?.originalName || a.filename || a.id,
  mimeType: a.mimeType || a.asset?.fileInfo?.mimeType || '',
  size: Number(a.size) || 0,
  visibility: a.visibility,
  createdAt: a.createdAt ?? '',
  checkedOutBy: a.asset?.checkedOutBy ?? null,
})
const base = () => `/v1/media/${dataset()}`
async function read<T>(path: string): Promise<T> {
  const res = await bpFetch(path)
  if (!res.ok) throw new Error(`Barkpark ${res.status} reading the media library`)
  return ((await res.json()) as {result: T}).result
}
async function send(path: string, init: RequestInit) {
  const res = await bpFetch(path, init)
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`)
}

const fetchCollections = createServerFn({method: 'GET'}).handler(async () => {
  const r = await read<{collections: {_id?: string; id?: string; title?: string; kind?: string}[]}>(`${base()}/collections?limit=100`)
  return r.collections.map((c) => ({id: String(c.id ?? c._id), title: c.title || 'Untitled folder', kind: c.kind ?? 'folder'})) as unknown as Json
})
export const collectionsQuery = queryOptions({queryKey: ['media', 'collections'], queryFn: async () => (await fetchCollections()) as unknown as Collection[]})

const fetchAssets = createServerFn({method: 'GET'})
  .validator((d: {collection?: string; q?: string; visibility?: Visibility}) => d)
  .handler(async ({data}) => {
    const params = new URLSearchParams({limit: '200', sort: 'created-desc'})
    if (data.q) params.set('q', data.q)
    if (data.collection) {
      const r = await read<{assets?: RawAsset[]; hits?: RawAsset[]; hasMore?: boolean}>(`${base()}/collections/${encodeURIComponent(data.collection)}/assets?${params}`)
      const assets = (r.assets ?? r.hits ?? []).map(toAsset).filter((a) => !data.visibility || a.visibility === data.visibility)
      return {assets, more: !!r.hasMore, total: r.hasMore ? null : assets.length} as unknown as Json
    }
    // The search's visibility facet (#22127: an asset with none stored is public).
    if (data.visibility) params.set('facet.visibility', data.visibility)
    const r = await read<{hits: RawAsset[]; hasMore?: boolean; total?: number}>(`${base()}/search?${params}`)
    return {assets: r.hits.map(toAsset), more: !!r.hasMore, total: r.total ?? null} as unknown as Json
  })
export const assetsQuery = (f: {collection?: string; q?: string; visibility?: Visibility}) =>
  queryOptions({queryKey: ['media', 'assets', f], queryFn: async () => (await fetchAssets({data: f})) as unknown as {assets: LibraryAsset[]; more: boolean; total: number | null}})

const fetchAsset = createServerFn({method: 'GET'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    const a = await read<RawAsset>(`${base()}/${encodeURIComponent(data.id)}`)
    const detail: AssetDetail = {
      ...toAsset(a),
      docId: (a.asset?._id ?? a.assetDocId ?? `asset-${a.id}`).replace(/^drafts\./, ''),
      title: a.asset?.title,
      altText: a.asset?.altText,
      checkoutLabel: a.checkoutLabel ?? null,
      checkedOutAt: a.asset?.checkedOutAt,
      canEdit: (a.permissions ?? []).includes('edit_metadata'),
      visibilityNotice: a.visibilityNotice && {label: a.visibilityNotice.label, copy: a.visibilityNotice.copy},
    }
    return detail as unknown as Json
  })
export const assetQuery = (id: string) => queryOptions({queryKey: ['media', 'asset', id], queryFn: async () => (await fetchAsset({data: {id}})) as unknown as AssetDetail})

/** Check out (lock) or release an asset (Barkpark's advisory lock on its edits). */
export const setCheckout = createServerFn({method: 'POST'})
  .validator((d: {id: string; out: boolean}) => d)
  .handler(async ({data}) => send(`${base()}/${encodeURIComponent(data.id)}/${data.out ? 'checkout' : 'undo-checkout'}`, {method: 'POST'}))

/** A folder (LiveView: a mediaCollection of kind folder), through the media API. */
export const createFolder = createServerFn({method: 'POST'})
  .validator((d: {title: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`${base()}/collections`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({title: data.title, kind: 'folder'})})
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`)
    return ((await res.json()) as {result: {id: string}}).result.id
  })

/** Put an asset in a folder, or take it out. */
export const setMember = createServerFn({method: 'POST'})
  .validator((d: {collection: string; asset: string; member: boolean}) => d)
  .handler(async ({data}) => {
    const path = `${base()}/collections/${encodeURIComponent(data.collection)}/members`
    if (data.member) await send(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({assetId: data.asset})})
    else await send(`${path}/${encodeURIComponent(data.asset)}`, {method: 'DELETE'})
  })

/** Title and alt text: Barkpark's PATCH on the asset (#22049), which honours its checkout lock. */
export const saveAssetMeta = createServerFn({method: 'POST'})
  .validator((d: {id: string; set: {title?: string; altText?: string}}) => d)
  .handler(async ({data}) =>
    send(`${base()}/${encodeURIComponent(data.id)}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify(data.set)}),
  )
