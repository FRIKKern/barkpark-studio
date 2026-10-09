import {createFileRoute} from '@tanstack/react-router'
import {assetUsage} from '../../../../server/asset-usage'

// GET /api/media/<asset id>/usage → the documents whose image or file fields use this
// asset: [{_id, _type, title}] (server/asset-usage.ts).
export const Route = createFileRoute('/api/media/$id/usage')({
  server: {
    handlers: {
      GET: async ({params}) => Response.json(await assetUsage(params.id)),
    },
  },
})
