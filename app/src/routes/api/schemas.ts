import {createFileRoute} from '@tanstack/react-router'
import {dataset, proxy} from '../../server/barkpark'

export const Route = createFileRoute('/api/schemas')({
  server: {handlers: {GET: () => proxy(`/v1/schemas/${dataset()}`)}},
})
