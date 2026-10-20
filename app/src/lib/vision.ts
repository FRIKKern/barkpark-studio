import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset, scope} from '../server/barkpark'
import {visionTarget} from '../server/vision'

// J37, Vision: Sanity's query tool. A query is GROQ, read through Barkpark's
// Sanity-compatible GROQ API (task-8919d95d9e581c6b), or Barkpark's older form, the part
// of the URL after the dataset (`post?filter[title][contains]=post&limit=5`); either is
// read with the editor's own token. Reads only: anything but a type and a query
// string is refused before it reaches Barkpark. Like Sanity's, Vision picks its own
// dataset in the project (the page's by default); a dataset-bound token (Barkpark #22393)
// reads only its own.

export const PERSPECTIVES = ['drafts', 'published', 'raw'] as const
export type Perspective = (typeof PERSPECTIVES)[number]

/**
 * `url`: the query as Barkpark's path; `href`: the whole address, to copy and run elsewhere
 * (with a token). `groq`: the body is Barkpark's GROQ answer, {query, result, ms}, of which
 * Vision shows `result`, as Sanity's; `ms` is then the server's own time (Sanity's Execution).
 */
export type VisionResult = {ok: boolean; status: number; url: string; href?: string; ms: number; body: string; error?: string; sent?: string; groq?: boolean}

export const runVisionQuery = createServerFn({method: 'GET'})
  .validator((d: {query: string; perspective: Perspective; dataset?: string; params?: string; version?: string}) => d)
  .handler(async ({data}): Promise<VisionResult> => {
    const target = await visionTarget(data)
    if ('error' in target) return {ok: false, status: 0, url: '', ms: 0, body: '', error: target.error}
    const path = target.kind === 'groq' ? target.path : `/v1/data/query/${target.ds}/${target.type}?${target.params}`
    const url = target.kind === 'groq' ? path : `/v1/data/query/${target.ds}/${target.type}?${decodeURIComponent(target.params.toString())}`
    const t0 = performance.now()
    const res = await bpFetch(path)
    const text = await res.text()
    let ms = Math.round(performance.now() - t0)
    let body = text
    try {
      const json = JSON.parse(text) as {ms?: unknown}
      if (target.kind === 'groq' && typeof json.ms === 'number') ms = json.ms
      // A GROQ answer is drawn as a tree from its parse: sent as it came (a 4 MB result was 5.5 MB
      // indented, and parsed back on the page). Barkpark's query string shows as text: indented.
      if (target.kind !== 'groq') body = JSON.stringify(json, null, 2)
    } catch {}
    return {ok: res.ok, status: res.status, url, href: `${process.env.BARKPARK_URL}/w/${scope().workspace}/p/${scope().project}${url}`, ms, body, sent: target.sent, groq: target.kind === 'groq'}
  })

export const visionDataset = createServerFn({method: 'GET'}).handler(async () => dataset())
