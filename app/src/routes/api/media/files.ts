import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset} from '../../../server/barkpark'
import {accepts, type FileAsset} from '../../../lib/files'

// GET /api/media/files?accept=application/pdf → the dataset's files a file field may
// pick, newest first: [{id, name, size, mimeType, createdAt}]. Like Sanity's file
// picker, only what the field accepts; images belong to image fields.
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
        const accept = new URL(request.url).searchParams.get('accept') ?? undefined
        const res = await bpFetch(`/v1/media/${dataset()}?limit=200`)
        if (!res.ok) return new Response(await res.text(), {status: res.status})
        const {result} = (await res.json()) as {result: {assets: Raw[]}}
        const files = result.assets
          .map(toFile)
          .filter((f) => !f.mimeType.startsWith('image/') && accepts(accept, {name: f.name, type: f.mimeType}))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        return Response.json(files)
      },
    },
  },
})
