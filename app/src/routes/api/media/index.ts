import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset} from '../../../server/barkpark'

// GET /api/media/?offset= → a page of the dataset's images, newest first:
// {images: [{id, name, createdAt}], nextOffset (null on the last page), total}.
// Barkpark filters by type and orders them, so pages follow on (the picker once read
// one page of every kind and kept its images: 138 of 303 at scale, the rest unreachable).
// 100: Barkpark answers 100 full records in ~220 ms, 200 in ~500 (637 KB); the first tiles
// came at 950 ms with 200, Sanity's at 530. A hundred tiles fill the dialog several times.
const PAGE = 100
export const Route = createFileRoute('/api/media/')({
  server: {
    handlers: {
      GET: async ({request}) => {
        const offset = Math.max(0, Number(new URL(request.url).searchParams.get('offset')) || 0)
        const res = await bpFetch(`/v1/media/${dataset()}?type=image&limit=${PAGE}&offset=${offset}`)
        if (!res.ok) return new Response(await res.text(), {status: res.status})
        const {result} = (await res.json()) as {result: {assets: {id: string; originalName?: string; filename?: string; createdAt?: string}[]; hasMore: boolean; nextOffset?: number; total: number}}
        return Response.json({
          images: result.assets.map((a) => ({id: a.id, name: a.originalName ?? a.filename ?? a.id, createdAt: a.createdAt ?? ''})),
          nextOffset: result.hasMore ? (result.nextOffset ?? offset + PAGE) : null,
          total: result.total,
        })
      },
    },
  },
})
