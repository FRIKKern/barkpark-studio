import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'

// A document's PortableDoc block list, for the Freeform canvas (decision 0004).
// Reads take `?perspective=drafts` (the draft when there is one: `raw` answers the
// published row by its exact id, so a Classic edit's draft was missing); a canvas
// batch is one atomic write (applyBlockOps).

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
    // A Bulldocs paper's ops fence on its own integer `rev` (Barkpark #22149), not `_rev`.
    const rev = data.type === 'paper' && !data.field ? ((doc.rev as number | undefined) ?? 0) : doc._rev
    return {rev, blocks} as Json
  })

/** `rev`: the doc's `_rev`, or a paper's integer rev (what its ops fence on). */
export type Rev = string | number
export type Blocks = {rev: Rev; blocks: Block[]}
export const blocksQuery = (type: string, id: string, field?: string) =>
  queryOptions({queryKey: ['blocks', id, field ?? ''], staleTime: 0, queryFn: async () => (await fetchBlocks({data: {type, id, field}})) as unknown as Blocks})
export const readBlocks = async (type: string, id: string, field?: string) => (await fetchBlocks({data: {type, id, field}})) as unknown as Blocks

/**
 * Apply a canvas batch as ONE atomic write (Barkpark #21895 / #21900): all ops land
 * or none, fenced on `ifRev`; `rev` is the doc's rev after it. A field's own list
 * goes to /fields/:field/ops, the doc's to /ops.
 */
export type OpsResult = {ok: true; rev: Rev} | {ok: false; status: number; code?: string; message: string; rev: Rev; actual?: Rev}
export const applyBlockOps = createServerFn({method: 'POST'})
  .validator((d: {type: string; id: string; field?: string; ops: Json[]; ifRev: Rev}) => d)
  .handler(async ({data}) => {
    // A Bulldocs paper's own list goes to its member-token route (Barkpark #22149): the
    // document route refuses papers. Same body, same 412 envelope.
    const path = data.field
      ? `${docPath(data.type, data.id)}/fields/${encodeURIComponent(data.field)}/ops`
      : data.type === 'paper'
        ? `/v1/papers/${encodeURIComponent(data.id)}/ops?dataset=${encodeURIComponent(dataset())}`
        : `${docPath(data.type, data.id)}/ops`
    const res = await bpFetch(path, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({ops: data.ops, ifRev: data.ifRev}),
    })
    const body = (await res.json().catch(() => ({}))) as {result?: {rev: string}; rev?: number; error?: {code?: string; message?: string; details?: {actual?: Rev}}}
    // A 412 names the doc's current rev (`details.actual`): the batch goes again on it.
    if (!res.ok) return {ok: false, status: res.status, code: body.error?.code, message: body.error?.message ?? `Barkpark ${res.status}`, rev: data.ifRev, actual: body.error?.details?.actual} as Json
    // The document route answers {result: {rev}}, the paper route its receipt {rev, …}.
    return {ok: true, rev: (body.result?.rev ?? body.rev)!} as Json
  })

/** Where the canvas bundle lives: the connected Barkpark serves it (no token needed). */
export const canvasOrigin = createServerFn({method: 'GET'}).handler(async () => process.env.BARKPARK_URL ?? '')
