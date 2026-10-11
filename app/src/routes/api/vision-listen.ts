import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, scope} from '../../server/barkpark'
import {clientGone} from '../../server/client-gone'
import {visionTarget} from '../../server/vision'
import type {Perspective} from '../../lib/vision'

// J37, Vision's Listen: GET /api/vision-listen?query=post?filter[x]=y&perspective=drafts&dataset=…
// → Barkpark's listen stream for that query, passed through as it comes. Barkpark narrows
// it itself (?types, ?perspective, filter[field]=value equality); order, limit and offset
// mean nothing to a stream and are left out. An operator filter (filter[f][op]=) is
// refused by Barkpark, and that answer is passed on. One upstream per Listen: it closes
// when the page stops listening.
export const Route = createFileRoute('/api/vision-listen')({
  server: {
    handlers: {
      GET: async ({request}) => {
        const q = new URL(request.url).searchParams
        const target = await visionTarget({query: q.get('query') ?? '', perspective: (q.get('perspective') ?? 'drafts') as Perspective, dataset: q.get('dataset') ?? undefined})
        if ('error' in target) return Response.json({error: {message: target.error}}, {status: 400})
        const params = new URLSearchParams({types: target.type})
        for (const [k, v] of target.params) if (k === 'perspective' || k.startsWith('filter[')) params.append(k, v)
        const gone = clientGone(request)
        const upstream = new AbortController()
        gone.addEventListener('abort', () => upstream.abort())
        const res = await bpFetch(`/v1/data/listen/${target.ds}?${params}`, {headers: {accept: 'text/event-stream'}, signal: upstream.signal}, undefined, {at: {...scope(), dataset: target.ds}})
        if (!res.ok || !res.body) return new Response(await res.text(), {status: res.status || 502, headers: {'content-type': res.headers.get('content-type') ?? 'text/plain'}})
        return new Response(res.body, {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'}})
      },
    },
  },
})
