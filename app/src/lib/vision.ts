import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset, scope} from '../server/barkpark'
import {visionTarget} from '../server/vision'

// J37, Vision: Sanity's query tool, for Barkpark's query API. A query is the part
// of the URL after the dataset — `post?filter[title][contains]=post&limit=5` —
// read with the editor's own token. Reads only: anything but a type and a query
// string is refused before it reaches Barkpark. Like Sanity's, Vision picks its own
// dataset in the project (the page's by default); a dataset-bound token (Barkpark #22393)
// reads only its own.

export const PERSPECTIVES = ['drafts', 'published', 'raw'] as const
export type Perspective = (typeof PERSPECTIVES)[number]

/** `url`: the query as Barkpark's path; `href`: the whole address, to copy and run elsewhere (with a token). */
export type VisionResult = {ok: boolean; status: number; url: string; href?: string; ms: number; body: string; error?: string}

export const runVisionQuery = createServerFn({method: 'GET'})
  .validator((d: {query: string; perspective: Perspective; dataset?: string}) => d)
  .handler(async ({data}): Promise<VisionResult> => {
    const target = await visionTarget(data)
    if ('error' in target) return {ok: false, status: 0, url: '', ms: 0, body: '', error: target.error}
    const {ds, type, params} = target
    const url = `/v1/data/query/${ds}/${type}?${decodeURIComponent(params.toString())}`
    const t0 = performance.now()
    const res = await bpFetch(`/v1/data/query/${ds}/${type}?${params}`)
    const text = await res.text()
    const ms = Math.round(performance.now() - t0)
    let body = text
    try {
      body = JSON.stringify(JSON.parse(text), null, 2)
    } catch {}
    return {ok: res.ok, status: res.status, url, href: `${process.env.BARKPARK_URL}/w/${scope().workspace}/p/${scope().project}${url}`, ms, body}
  })

export const visionDataset = createServerFn({method: 'GET'}).handler(async () => dataset())
