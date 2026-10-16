import {createFileRoute} from '@tanstack/react-router'
import {apiBase, bpFetch, bpFile, bpRaw, dataset} from '../../../../server/barkpark'
import {fallsBackToOriginal, mediaHeaders, transformQuery} from '../../../../lib/media-proxy'

// GET /api/media/<asset id> → the file's bytes. Barkpark serves media files to a token only,
// and an <img> can't send one, so the studio fetches them for it. An image takes Barkpark's
// transform parameters (lib/image.ts imageSrc: w, h, fit, auto=format), so a row thumbnail or
// a field preview gets the size it shows at, as AVIF or WebP, instead of the original
// (docs/media/IMAGE-TRANSFORMS.md in Barkpark). ?size=thumb is the 320 px JPEG preset.
// An asset's path never changes under its id: one metadata read per asset, not per image.
// Shared across editors on purpose: the path is never sent to the browser, and the file
// read below goes with the requesting editor's own token (signed out: none), which
// Barkpark checks on every file and transform read (403 without a seat, as the metadata
// read would answer).
const paths = new Map<string, {url: string; mimeType?: string}>()

export const Route = createFileRoute('/api/media/$id/')({
  server: {
    handlers: {
      GET: async ({params, request}) => {
        const query = new URL(request.url).searchParams
        if (query.get('size') === 'thumb') {
          const thumb = await bpRaw(`/media/renditions/${encodeURIComponent(params.id)}/thumb`)
          return new Response(thumb.body, {status: thumb.status, headers: mediaHeaders(thumb.ok, thumb.headers.get('content-type') ?? 'image/jpeg')})
        }
        const key = `${apiBase()}|${dataset()}|${params.id}`
        let asset = paths.get(key)
        if (!asset) {
          const meta = await bpFetch(`/v1/media/${dataset()}/${encodeURIComponent(params.id)}`)
          if (!meta.ok) return new Response(null, {status: meta.status})
          asset = ((await meta.json()) as {result: {url: string; mimeType?: string}}).result
          if (paths.size > 5000) paths.clear()
          paths.set(key, asset)
        }
        const transform = transformQuery(query)
        const accept = {accept: request.headers.get('accept') ?? 'image/*'}
        let file = transform && asset.mimeType?.startsWith('image/') ? await bpFile(`${asset.url}?${transform}`, accept) : null
        if (!file || fallsBackToOriginal(file.status)) file = await bpFile(asset.url, accept)
        return new Response(file.body, {
          status: file.status,
          headers: mediaHeaders(file.ok, file.headers.get('content-type') ?? asset.mimeType ?? 'application/octet-stream'),
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
