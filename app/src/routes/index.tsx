import {createFileRoute, Link} from '@tanstack/react-router'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'

const health = createServerFn({method: 'GET'}).handler(async () => {
  const started = Date.now()
  const counts: Record<string, number | string> = {}
  for (const type of ['post', 'author', 'category']) {
    const res = await bpFetch(`/v1/data/query/${dataset()}/${type}?limit=1&count=true`)
    counts[type] = res.ok ? (await res.json()).result.total : `HTTP ${res.status}`
  }
  return {ok: Object.values(counts).every((c) => typeof c === 'number'), counts, ms: Date.now() - started}
})

export const Route = createFileRoute('/')({
  loader: () => health(),
  component: Health,
})

function Health() {
  const h = Route.useLoaderData()
  return (
    <main>
      <h1>Barkpark Studio</h1>
      <p data-testid="health">
        Barkpark: <strong>{h.ok ? 'ok' : 'down'}</strong> ({h.ms} ms)
      </p>
      <pre>{JSON.stringify(h.counts, null, 2)}</pre>
      <Link to="/debug/live" search={{id: 'post-01'}}>
        Live stream debug →
      </Link>
    </main>
  )
}
