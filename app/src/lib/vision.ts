import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'

// J37, Vision: Sanity's query tool, for Barkpark's query API. A query is the part
// of the URL after the dataset — `post?filter[title][contains]=post&limit=5` —
// read with the editor's own token. Reads only: anything but a type and a query
// string is refused before it reaches Barkpark.

export const PERSPECTIVES = ['drafts', 'published', 'raw'] as const
export type Perspective = (typeof PERSPECTIVES)[number]
const QUERY = /^[A-Za-z0-9_-]+(\?[^#\n]*)?$/

export type VisionResult = {ok: boolean; status: number; url: string; ms: number; body: string; error?: string}

export const runVisionQuery = createServerFn({method: 'GET'})
  .validator((d: {query: string; perspective: Perspective}) => d)
  .handler(async ({data}): Promise<VisionResult> => {
    const query = data.query.trim()
    if (!QUERY.test(query)) return {ok: false, status: 0, url: '', ms: 0, body: '', error: 'A query is a type, then an optional ?query string: post?filter[title][contains]=post&limit=5'}
    const [type, qs = ''] = query.split(/\?(.*)/s)
    const params = new URLSearchParams(qs)
    if (!params.has('perspective')) params.set('perspective', PERSPECTIVES.includes(data.perspective) ? data.perspective : 'drafts')
    const url = `/v1/data/query/${dataset()}/${type}?${decodeURIComponent(params.toString())}`
    const t0 = performance.now()
    const res = await bpFetch(`/v1/data/query/${dataset()}/${type}?${params}`)
    const text = await res.text()
    const ms = Math.round(performance.now() - t0)
    let body = text
    try {
      body = JSON.stringify(JSON.parse(text), null, 2)
    } catch {}
    return {ok: res.ok, status: res.status, url, ms, body}
  })

export const visionDataset = createServerFn({method: 'GET'}).handler(async () => dataset())
