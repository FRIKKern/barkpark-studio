import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, bpFile, bpRaw, dataset} from '../../../../server/barkpark'
import {assetUsage} from '../../../../server/asset-usage'

// GET /api/media/<asset id> → the image bytes (?size=thumb: Barkpark's thumbnail
// rendition, one request and small — the library's tiles). Barkpark serves media files to a
// token only, and an <img> can't send one, so the studio fetches them for it.
export const Route = createFileRoute('/api/media/$id/')({
  server: {
    handlers: {
      GET: async ({params, request}) => {
        // An asset's bytes never change under its id.
        const immutable = {'cache-control': 'private, max-age=31536000, immutable'}
        if (new URL(request.url).searchParams.get('size') === 'thumb') {
          const thumb = await bpRaw(`/media/renditions/${encodeURIComponent(params.id)}/thumb`)
          return new Response(thumb.body, {status: thumb.status, headers: {'content-type': thumb.headers.get('content-type') ?? 'image/jpeg', ...immutable}})
        }
        const meta = await bpFetch(`/v1/media/${dataset()}/${encodeURIComponent(params.id)}`)
        if (!meta.ok) return new Response(null, {status: meta.status})
        const {result} = (await meta.json()) as {result: {url: string; mimeType?: string}}
        const file = await bpFile(result.url)
        return new Response(file.body, {
          status: file.status,
          headers: {'content-type': file.headers.get('content-type') ?? result.mimeType ?? 'application/octet-stream', ...immutable},
        })
      },
      // J36: Sanity's asset Delete. An asset in use is never deleted (409 with its uses):
      // Barkpark's media delete doesn't check references, so the studio does.
      DELETE: async ({params}) => {
        const uses = await assetUsage(params.id)
        if (uses.length) return Response.json({error: 'in use', uses}, {status: 409})
        const res = await bpFetch(`/v1/media/${dataset()}/${encodeURIComponent(params.id)}`, {method: 'DELETE'})
        return new Response(null, {status: res.ok ? 204 : res.status})
      },
    },
  },
})
