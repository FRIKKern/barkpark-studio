import {createFileRoute} from '@tanstack/react-router'
import {dataset, proxy} from '../../../server/barkpark'

export const Route = createFileRoute('/api/backlinks/$id')({
  server: {
    handlers: {
      GET: ({params}) => proxy(`/v1/data/backlinks/${dataset()}/${encodeURIComponent(params.id)}`),
    },
  },
})
