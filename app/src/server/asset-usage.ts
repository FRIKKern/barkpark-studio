import '@tanstack/react-start/server-only'
import {bpFetch, dataset} from './barkpark'
import {readSchemas} from './schemas'

export type Use = {_id: string; _type: string; title?: string}
type Field = {name: string; type: string}

/**
 * J36: the documents that use an asset. Barkpark's backlinks index image fields'
 * asset refs (#22042, nested in arrays too); file fields not yet
 * (task-7150f77eb6fbc640), so each type's file fields are asked by filter.
 */
export async function assetUsage(assetId: string): Promise<Use[]> {
  const ref = `asset-${assetId}`
  const linked = (async () => {
    const res = await bpFetch(`/v1/data/backlinks/${dataset()}/${encodeURIComponent(ref)}`)
    if (!res.ok) throw new Error(`Barkpark backlinks → ${res.status}`)
    const {result} = (await res.json()) as {result: {backlinks: {from_doc_id: string; type: string; title?: string}[]}}
    return result.backlinks.map((b) => ({_id: b.from_doc_id.replace(/^drafts\./, ''), _type: b.type, title: b.title}))
  })()
  const asks = (await readSchemas()).flatMap((s) => (s.fields as Field[]).filter((f) => f.type === 'file').map((f) => ({type: s.name, field: f.name})))
  const files = asks.map(async ({type, field}) => {
    const q = `perspective=drafts&limit=50&filter[${encodeURIComponent(`${field}.asset._ref`)}]=${encodeURIComponent(ref)}`
    const res = await bpFetch(`/v1/data/query/${dataset()}/${encodeURIComponent(type)}?${q}`)
    if (!res.ok) throw new Error(`Barkpark ${type} → ${res.status}`)
    const {result} = (await res.json()) as {result: {documents: {_id: string; _publishedId?: string; _type: string; title?: string}[]}}
    return result.documents.map((d) => ({_id: d._publishedId ?? d._id.replace(/^drafts\./, ''), _type: d._type, title: d.title}))
  })
  const all = (await Promise.all([linked, ...files])).flat()
  return [...new Map(all.map((u) => [u._id, u])).values()]
}
