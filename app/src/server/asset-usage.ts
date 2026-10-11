import '@tanstack/react-start/server-only'
import {bpFetch, dataset} from './barkpark'

export type Use = {_id: string; _type: string; title?: string}

/**
 * J36: the documents that use an asset, from Barkpark's backlinks: image and file
 * fields' asset refs, nested in arrays too, drafts included (#22042, #22418).
 */
export async function assetUsage(assetId: string): Promise<Use[]> {
  const res = await bpFetch(`/v1/data/backlinks/${dataset()}/${encodeURIComponent(`asset-${assetId}`)}`)
  if (!res.ok) throw new Error(`Barkpark backlinks → ${res.status}`)
  const {result} = (await res.json()) as {result: {backlinks: {from_doc_id: string; type: string; title?: string}[]}}
  const uses = result.backlinks.map((b) => ({_id: b.from_doc_id.replace(/^drafts\./, ''), _type: b.type, title: b.title}))
  return [...new Map(uses.map((u) => [u._id, u])).values()]
}
