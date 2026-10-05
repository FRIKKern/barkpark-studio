import {createFileRoute} from '@tanstack/react-router'
import {dataset, proxy} from '../../../../server/barkpark'

export const Route = createFileRoute('/api/doc/$type/$id')({
  server: {
    handlers: {
      GET: ({request, params}) =>
        proxy(
          `/v1/data/doc/${dataset()}/${encodeURIComponent(params.type)}/${encodeURIComponent(params.id)}${new URL(request.url).search}`,
        ),
    },
  },
})
