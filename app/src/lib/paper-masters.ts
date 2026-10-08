import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'

// D13: paper masters, Barkpark's reusable blocks (Bulldocs `paper_master` docs; routes
// from FRIKKern/barkpark#22073). A paper's masters are the ones saved in its scope;
// the canvas offers them in its / menu and "Save as master" in its block menu, and
// asks the host (bp-master-insert, bp-save-master), which writes here. A write answers
// with the paper's new rev only: the host reads the blocks back.

export type Master = {docId: string; rev: string; title: string; tier: string; blockType: string; sourcePaper?: string; sourceBlockId?: string}
type Receipt = {rev: number | string; blockIds?: string[]}
export type MasterResult = {ok: true; receipt?: Receipt; master?: Master} | {ok: false; status: number; code?: string; message: string}

const base = (slug: string) => `/v1/papers/${encodeURIComponent(slug)}/masters`
const scoped = (path: string) => `${path}${path.includes('?') ? '&' : '?'}dataset=${encodeURIComponent(dataset())}`

async function call(path: string, body: unknown): Promise<MasterResult> {
  const res = await bpFetch(scoped(path), {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}, undefined, {retry: false})
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {error?: {code?: string; message?: string}}
  if (!res.ok) return {ok: false, status: res.status, code: json.error?.code, message: json.error?.message ?? `Barkpark ${res.status}`}
  return 'docId' in json ? {ok: true, master: json as unknown as Master} : {ok: true, receipt: json as unknown as Receipt}
}

const fetchMasters = createServerFn({method: 'GET'})
  .validator((d: {slug: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(scoped(base(data.slug)))
    if (!res.ok) return [] // no masters for this paper (or not a Bulldocs paper): nothing to offer
    return ((await res.json()) as {masters: Master[]}).masters
  })

export const mastersQuery = (slug: string) => queryOptions({queryKey: ['paper-masters', slug], staleTime: 30_000, queryFn: async () => (await fetchMasters({data: {slug}})) as Master[]})

/** Save a block the server holds as a master (published at once). */
export const saveMaster = createServerFn({method: 'POST'})
  .validator((d: {slug: string; blockId: string; title?: string}) => d)
  .handler(async ({data}) => (await call(base(data.slug), {blockId: data.blockId, ...(data.title && {title: data.title})})) as never)

/** Insert a master after `afterId` (null: at the end): a detached copy, or a linked instance. */
export const insertMaster = createServerFn({method: 'POST'})
  .validator((d: {slug: string; masterId: string; afterId: string | null; mode?: 'detached' | 'linked'; requestId: string}) => d)
  .handler(
    async ({data}) =>
      (await call(`${base(data.slug)}/${encodeURIComponent(data.masterId)}/insert`, {mode: data.mode ?? 'detached', ...(data.afterId && {afterId: data.afterId}), requestId: data.requestId})) as never,
  )
