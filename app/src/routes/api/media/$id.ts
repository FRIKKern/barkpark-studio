import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, bpFile, dataset} from '../../../server/barkpark'

// GET /api/media/<asset id> → the image bytes. Barkpark serves media files to a
// token only, and an <img> can't send one, so the studio fetches them for it.
export const Route = createFileRoute('/api/media/$id')({
  server: {
    handlers: {
      GET: async ({params}) => {
        const meta = await bpFetch(`/v1/media/${dataset()}/${encodeURIComponent(params.id)}`)
        if (!meta.ok) return new Response(null, {status: meta.status})
        const {result} = (await meta.json()) as {result: {url: string; mimeType?: string}}
        const file = await bpFile(result.url)
        return new Response(file.body, {
          status: file.status,
          // An asset's bytes never change under its id.
          headers: {'content-type': file.headers.get('content-type') ?? result.mimeType ?? 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable'},
        })
      },
    },
  },
})
