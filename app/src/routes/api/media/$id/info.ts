import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, bpRaw, dataset} from '../../../../server/barkpark'
import {sanityImageId, sanityImagePath} from '../../../../lib/image'
import {toFile} from '../files'
import {imageMeta, type RawImageAsset} from '../../../../lib/image-meta'

// GET /api/media/<asset id>/info → what a file field shows: {id, name, size, mimeType, createdAt};
// for an image also its size and blur placeholder (lib/image-meta.ts).
export const Route = createFileRoute('/api/media/$id/info')({
  server: {
    handlers: {
      GET: async ({params}) => {
        // A Sanity image id: whether Barkpark has its file (HEAD on the Sanity image route:
        // 404 when it has none), and what the id itself states. The image field shows the
        // "Unsupported asset value" card on a 404.
        const sanity = sanityImageId(params.id)
        if (sanity) {
          const head = await bpRaw(sanityImagePath(sanity, dataset()), {method: 'HEAD'})
          if (!head.ok) return new Response(null, {status: head.status})
          const name = `${sanity.sha1}-${sanity.width}x${sanity.height}.${sanity.ext}`
          const mimeType = head.headers.get('content-type')?.split(';')[0] ?? ''
          return Response.json({id: params.id, name, size: Number(head.headers.get('content-length')) || 0, mimeType, createdAt: '', width: sanity.width, height: sanity.height})
        }
        const res = await bpFetch(`/v1/media/${dataset()}/${encodeURIComponent(params.id)}`)
        if (!res.ok) return new Response(null, {status: res.status})
        const result = ((await res.json()) as {result: Parameters<typeof toFile>[0] & RawImageAsset & {url?: string}}).result
        // `url`: the file's path, for content that stores the legacy image shape {assetId, url}.
        return Response.json({...toFile(result), ...imageMeta(result), url: result.url})
      },
    },
  },
})
