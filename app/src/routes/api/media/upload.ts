import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset, requestToken, scope} from '../../../server/barkpark'
import {madeAsset, relayUpload} from '../../../lib/upload-relay'

// POST /api/media/upload (multipart, one `file`) → Barkpark's media upload.
// Answers what an image field stores and draws: {ref: "asset-<id>", width, height}, and
// the file's own Barkpark path (`url`, /w/<ws>/p/<project>/media/files/…), which an image
// block in the canvas stores as its src (D07; served here by routes/w/$.ts). A Cancel in
// the browser stops it here or deletes what Barkpark made (lib/upload-relay.ts).
export const Route = createFileRoute('/api/media/upload')({
  server: {
    handlers: {
      POST: async ({request}) => {
        // The whole file first: a Cancel while the browser still sends it ends here.
        const bytes = new Uint8Array(await request.arrayBuffer())
        const path = `/v1/media/${dataset()}/upload`
        const headers = {'content-type': request.headers.get('content-type') ?? 'multipart/form-data'}
        // Pinned now, inside the request: a drop after the browser left runs outside it.
        const token = requestToken()
        const at = scope()
        const sent = await relayUpload(
          bytes,
          request.signal,
          (body, signal) => bpFetch(path, {method: 'POST', headers, body, signal, duplex: 'half'} as RequestInit, token, {retry: false, at}),
          async (res) => {
            const id = madeAsset(await res.clone().json().catch(() => ({})))
            if (id) await bpFetch(`/v1/media/${at.dataset}/${encodeURIComponent(id)}`, {method: 'DELETE'}, token, {retry: false, at}).catch(() => {})
          },
        )
        // Cancelled: nobody is listening, and nothing was left behind.
        if (sent.cancelled) return new Response(null, {status: 499})
        const res = sent.res
        const body = (await res.json().catch(() => ({}))) as {result?: {id: string; url?: string; asset?: {fileInfo?: {width?: string; height?: string}}}; error?: unknown}
        if (!res.ok || !body.result) return Response.json(body, {status: res.ok ? 502 : res.status})
        const info = body.result.asset?.fileInfo
        return Response.json({ref: `asset-${body.result.id}`, url: body.result.url, width: Number(info?.width) || undefined, height: Number(info?.height) || undefined})
      },
    },
  },
})
