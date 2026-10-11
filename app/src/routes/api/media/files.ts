import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset} from '../../../server/barkpark'
import {accepts, type FileAsset} from '../../../lib/files'

// GET /api/media/files?accept=application/pdf&offset= → a page of the files a file field
// may pick, newest first: {files: [{id, name, size, mimeType, createdAt}], nextOffset}.
// Like Sanity's file picker, only what the field accepts; images belong to image fields.
// Barkpark leaves out the images (exclude_type) and keeps the field's mime types (mime),
// paging what is left (#22705). An extension rule (".pdf") it can't judge, so then the
// batches it sends are read on and the matches kept: a page ends at PAGE files or SCAN
// media read, and nextOffset (null at the end) is where the next one resumes.
const PAGE = 50
const BATCH = 100
const SCAN = 500
/** The field's accept as Barkpark's mime list, when every rule is a type ("application/pdf", "text/*"). */
const mimeList = (accept?: string) => {
  const rules = (accept ?? '').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean)
  return rules.length && rules.every((r) => /^[a-z0-9!#$&^_.+-]+\/(\*|[a-z0-9!#$&^_.+-]+)$/.test(r)) ? rules.join(',') : undefined
}
type Raw = {id: string; size?: number; filename?: string; asset?: {_createdAt?: string; fileInfo?: {mimeType?: string; originalName?: string}}}
export const toFile = (a: Raw): FileAsset => ({
  id: a.id,
  name: a.asset?.fileInfo?.originalName || a.filename || a.id,
  size: a.size ?? 0,
  mimeType: a.asset?.fileInfo?.mimeType ?? '',
  createdAt: a.asset?._createdAt ?? '',
})

export const Route = createFileRoute('/api/media/files')({
  server: {
    handlers: {
      GET: async ({request}) => {
        const q = new URL(request.url).searchParams
        const accept = q.get('accept') ?? undefined
        const mime = mimeList(accept)
        let at = Math.max(0, Number(q.get('offset')) || 0)
        const start = at
        const files: FileAsset[] = []
        let more = true
        while (more && files.length < PAGE && at - start < SCAN) {
          const res = await bpFetch(`/v1/media/${dataset()}?exclude_type=image&limit=${BATCH}&offset=${at}${mime ? `&mime=${encodeURIComponent(mime)}` : ''}`)
          if (!res.ok) return new Response(await res.text(), {status: res.status})
          const {result} = (await res.json()) as {result: {assets: Raw[]; hasMore: boolean}}
          let read = 0
          for (const a of result.assets) {
            read++
            const f = toFile(a)
            if (!f.mimeType.startsWith('image/') && accepts(accept, {name: f.name, type: f.mimeType})) files.push(f)
            if (files.length === PAGE) break
          }
          at += read
          more = read < result.assets.length || result.hasMore
        }
        return Response.json({files, nextOffset: more ? at : null})
      },
    },
  },
})
