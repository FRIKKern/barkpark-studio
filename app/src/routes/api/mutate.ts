import {createFileRoute} from '@tanstack/react-router'
import {dataset, proxy, requestToken} from '../../server/barkpark'
import {expectEcho, mutatedIds} from '../../server/listen'

export const Route = createFileRoute('/api/mutate')({
  server: {
    handlers: {
      POST: async ({request}) => {
        const body = await request.text()
        const res = await proxy(`/v1/data/mutate/${dataset()}`, {method: 'POST', headers: {'content-type': 'application/json'}, body})
        if (res.ok) expectEcho(requestToken(), mutatedIds((JSON.parse(body) as {mutations?: unknown[]}).mutations ?? []))
        return res
      },
    },
  },
})
