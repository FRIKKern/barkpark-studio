import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset} from '../../../server/barkpark'

// GET /api/media/ → the dataset's images, newest first: [{id, name, createdAt}].
export const Route = createFileRoute('/api/media/')({
  server: {
    handlers: {
      GET: async () => {
        const res = await bpFetch(`/v1/media/${dataset()}?limit=200`)
        if (!res.ok) return new Response(await res.text(), {status: res.status})
        const {result} = (await res.json()) as {result: {assets: {id: string; originalName?: string; filename?: string; mimeType?: string; createdAt?: string}[]}}
        const images = result.assets
          .filter((a) => a.mimeType?.startsWith('image/'))
          .map((a) => ({id: a.id, name: a.originalName ?? a.filename ?? a.id, createdAt: a.createdAt ?? ''}))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        return Response.json(images)
      },
    },
  },
})
