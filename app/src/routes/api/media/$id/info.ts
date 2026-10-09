import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset} from '../../../../server/barkpark'
import {toFile} from '../files'

// GET /api/media/<asset id>/info → what a file field shows: {id, name, size, mimeType, createdAt}.
export const Route = createFileRoute('/api/media/$id/info')({
  server: {
    handlers: {
      GET: async ({params}) => {
        const res = await bpFetch(`/v1/media/${dataset()}/${encodeURIComponent(params.id)}`)
        if (!res.ok) return new Response(null, {status: res.status})
        const result = ((await res.json()) as {result: Parameters<typeof toFile>[0] & {url?: string}}).result
        // `url`: the file's path, for content that stores the legacy image shape {assetId, url}.
        return Response.json({...toFile(result), url: result.url})
      },
    },
  },
})
