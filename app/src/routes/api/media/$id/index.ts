import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, bpFile, bpRaw, dataset} from '../../../../server/barkpark'

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
      // J36: Sanity's asset Delete. Barkpark refuses an asset in use itself (409 with
      // where it is used, drafts included: #22427, #22452); that list goes to the dialog.
      DELETE: async ({params}) => {
        const res = await bpFetch(`/v1/media/${dataset()}/${encodeURIComponent(params.id)}`, {method: 'DELETE'})
        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as {error?: {details?: {referencedBy?: {doc_id: string; type: string; title?: string}[]}}}
          const uses = (body.error?.details?.referencedBy ?? []).map((r) => ({_id: r.doc_id.replace(/^drafts\./, ''), _type: r.type, title: r.title}))
          return Response.json({error: 'in use', uses: [...new Map(uses.map((u) => [u._id, u])).values()]}, {status: 409})
        }
        return new Response(null, {status: res.ok ? 204 : res.status})
      },
    },
  },
})
