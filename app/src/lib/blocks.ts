import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'

// A document's PortableDoc block list, for the Freeform canvas (decision 0004).
// Reads take `?perspective=drafts` (the draft when there is one: `raw` answers the
// published row by its exact id, so a Classic edit's draft was missing); writes go one op per
// request to /v1/data/doc/.../ops, each fenced on the rev the last one returned.

export type Block = {id: string; type: string} & Record<string, unknown>
export type BlockOp = {op: string} & Record<string, unknown>
type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

const docPath = (type: string, id: string) => `/v1/data/doc/${dataset()}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`

// `field`: a richText field's own block list (J10: `doc[field].blocks`) instead of the doc's.
const fetchBlocks = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string; field?: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`${docPath(data.type, data.id)}?perspective=drafts`)
    if (!res.ok) throw new Error(`Barkpark ${res.status} reading ${data.id}`)
    const doc = ((await res.json()) as {result: {_rev: string; blocks?: Json[]} & Record<string, Json>}).result
    const blocks = data.field ? ((doc[data.field] as {blocks?: Json[]} | null)?.blocks ?? []) : (doc.blocks ?? [])
    return {rev: doc._rev, blocks} as Json
  })

export type Blocks = {rev: string; blocks: Block[]}
export const blocksQuery = (type: string, id: string, field?: string) =>
  queryOptions({queryKey: ['blocks', id, field ?? ''], staleTime: 0, queryFn: async () => (await fetchBlocks({data: {type, id, field}})) as unknown as Blocks})
export const readBlocks = async (type: string, id: string, field?: string) => (await fetchBlocks({data: {type, id, field}})) as unknown as Blocks

/**
 * Apply a canvas batch. Barkpark takes one op per request (no batch route yet), so a
 * batch can land part-way: `applied` says how many did, `rev` is the doc's rev after them.
 */
export type OpsResult = {ok: true; rev: string} | {ok: false; status: number; code?: string; message: string; applied: number; rev: string}
export const applyBlockOps = createServerFn({method: 'POST'})
  .validator((d: {type: string; id: string; field?: string; ops: Json[]; ifRev: string}) => d)
  .handler(async ({data}) => {
    // A field's list: one atomic batch (all or none) on /fields/:field/ops.
    if (data.field) {
      const res = await bpFetch(`${docPath(data.type, data.id)}/fields/${encodeURIComponent(data.field)}/ops`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ops: data.ops, ifRev: data.ifRev}),
      })
      const body = (await res.json().catch(() => ({}))) as {result?: {rev: string}; error?: {code?: string; message?: string}}
      if (!res.ok) return {ok: false, status: res.status, code: body.error?.code, message: body.error?.message ?? `Barkpark ${res.status}`, applied: 0, rev: data.ifRev} as Json
      return {ok: true, rev: body.result!.rev} as Json
    }
    let rev = data.ifRev
    for (const [i, op] of data.ops.entries()) {
      const res = await bpFetch(`${docPath(data.type, data.id)}/ops`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({op, ifRev: rev}),
      })
      const body = (await res.json().catch(() => ({}))) as {result?: {rev: string}; error?: {code?: string; message?: string}}
      if (!res.ok) return {ok: false, status: res.status, code: body.error?.code, message: body.error?.message ?? `Barkpark ${res.status}`, applied: i, rev} as Json
      rev = body.result!.rev
    }
    return {ok: true, rev} as Json
  })

/** Where the canvas bundle lives: the connected Barkpark serves it (no token needed). */
export const canvasOrigin = createServerFn({method: 'GET'}).handler(async () => process.env.BARKPARK_URL ?? '')
