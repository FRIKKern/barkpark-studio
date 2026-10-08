import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset} from '../../../../server/barkpark'
import {readSchemas} from '../../../../server/schemas'

// GET /api/media/<asset id>/usage → the documents whose image or file fields use this
// asset: [{_id, _type, title}]. Barkpark's backlinks and media relations don't
// index image asset refs (task-94891b81179a0855), so this asks each type with an image
// field for docs whose `<field>.asset._ref` is the asset — a documented filter.
type Field = {name: string; type: string}
export const Route = createFileRoute('/api/media/$id/usage')({
  server: {
    handlers: {
      GET: async ({params}) => {
        const ref = `asset-${params.id}`
        const schemas = await readSchemas()
        const asks = schemas.flatMap((s) =>
          (s.fields as Field[]).filter((f) => f.type === 'image' || f.type === 'file').map((f) => ({type: s.name, field: f.name})),
        )
        const found = await Promise.all(
          asks.map(async ({type, field}) => {
            const q = `perspective=drafts&limit=50&filter[${encodeURIComponent(`${field}.asset._ref`)}]=${encodeURIComponent(ref)}`
            const res = await bpFetch(`/v1/data/query/${dataset()}/${encodeURIComponent(type)}?${q}`)
            if (!res.ok) return []
            const {result} = (await res.json()) as {result: {documents: {_id: string; _publishedId?: string; _type: string; title?: string}[]}}
            return result.documents.map((d) => ({_id: d._publishedId ?? d._id, _type: d._type, title: d.title}))
          }),
        )
        const byId = new Map(found.flat().map((d) => [d._id, d]))
        return Response.json([...byId.values()])
      },
    },
  },
})
