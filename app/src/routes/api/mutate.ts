import {createFileRoute} from '@tanstack/react-router'
import {dataset, proxy} from '../../server/barkpark'

export const Route = createFileRoute('/api/mutate')({
  server: {
    handlers: {
      POST: async ({request}) =>
        proxy(`/v1/data/mutate/${dataset()}`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: await request.text(),
        }),
    },
  },
})
