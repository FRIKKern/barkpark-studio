import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset} from '../../../server/barkpark'

// POST /api/media/upload (multipart, one `file`) → Barkpark's media upload.
// Answers what an image field stores and draws: {ref: "asset-<id>", width, height}, and
// the file's own Barkpark path (`url`, /w/<ws>/p/<project>/media/files/…), which an image
// block in the canvas stores as its src (D07; served here by routes/w/$.ts).
export const Route = createFileRoute('/api/media/upload')({
  server: {
    handlers: {
      POST: async ({request}) => {
        const res = await bpFetch(`/v1/media/${dataset()}/upload`, {
          method: 'POST',
          headers: {'content-type': request.headers.get('content-type') ?? 'multipart/form-data'},
          body: await request.arrayBuffer(),
        })
        const body = (await res.json().catch(() => ({}))) as {result?: {id: string; url?: string; asset?: {fileInfo?: {width?: string; height?: string}}}; error?: unknown}
        if (!res.ok || !body.result) return Response.json(body, {status: res.ok ? 502 : res.status})
        const info = body.result.asset?.fileInfo
        return Response.json({ref: `asset-${body.result.id}`, url: body.result.url, width: Number(info?.width) || undefined, height: Number(info?.height) || undefined})
      },
    },
  },
})
