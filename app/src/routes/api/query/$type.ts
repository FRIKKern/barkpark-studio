import {createFileRoute} from '@tanstack/react-router'
import {dataset, proxy} from '../../../server/barkpark'

export const Route = createFileRoute('/api/query/$type')({
  server: {
    handlers: {
      GET: ({request, params}) =>
        proxy(`/v1/data/query/${dataset()}/${encodeURIComponent(params.type)}${new URL(request.url).search}`),
    },
  },
})
