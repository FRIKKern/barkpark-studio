import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset} from '../../../server/barkpark'

// GET /api/media/by-sha1?sha1=<hex> → the asset with these bytes, as an upload answers it
// ({ref, url, width, height}), or 404. Barkpark keeps a sha1 per file (#22700; files from
// before it have none until a backfill, so a miss just means upload).
export const Route = createFileRoute('/api/media/by-sha1')({
  server: {
    handlers: {
      GET: async ({request}) => {
        const sha1 = new URL(request.url).searchParams.get('sha1') ?? ''
        if (!/^[0-9a-f]{40}$/.test(sha1)) return new Response('sha1 required', {status: 400})
        const res = await bpFetch(`/v1/media/${dataset()}?sha1=${sha1}&limit=1`)
        if (!res.ok) return new Response(await res.text(), {status: res.status})
        const {result} = (await res.json()) as {result: {assets: {id: string; url?: string; asset?: {fileInfo?: {width?: string; height?: string}}}[]}}
        const a = result.assets[0]
        if (!a) return new Response(null, {status: 404})
        const info = a.asset?.fileInfo
        return Response.json({ref: `asset-${a.id}`, url: a.url, width: Number(info?.width) || undefined, height: Number(info?.height) || undefined})
      },
    },
  },
})
