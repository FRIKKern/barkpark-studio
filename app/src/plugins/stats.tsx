import {queryOptions, useQuery} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import {schemasQuery, type Schema} from '../lib/data'

// J65's custom tool, the same as the reference Studio's: documents per type,
// published and drafts. Barkpark counts with `count=true`; drafts are what the
// raw perspective holds beyond the published copies.

type Row = {type: string; published: number; drafts: number}

const total = async (type: string, perspective: 'published' | 'raw') => {
  const res = await bpFetch(`/v1/data/query/${dataset()}/${encodeURIComponent(type)}?limit=1&count=true&perspective=${perspective}`)
  if (!res.ok) throw new Error(`Barkpark count ${type} → ${res.status}`)
  return ((await res.json()) as {result: {total?: number}}).result.total ?? 0
}

const fetchStats = createServerFn({method: 'GET'})
  .validator((types: string[]) => types)
  .handler(async ({data}) => {
    const rows = await Promise.all(data.map(async (type) => {
      const [published, raw] = await Promise.all([total(type, 'published'), total(type, 'raw')])
      return {type, published, drafts: Math.max(0, raw - published)}
    }))
    return rows.filter((r) => r.published + r.drafts > 0).sort((a, b) => a.type.localeCompare(b.type))
  })

const statsQuery = (types: string[]) => queryOptions({queryKey: ['stats', types], queryFn: () => fetchStats({data: types}) as Promise<Row[]>})

export function StatsTool() {
  const {data: schemas} = useQuery(schemasQuery)
  const {data: rows, error} = useQuery({...statsQuery((schemas ?? []).map((s: Schema) => s.name)), enabled: !!schemas})
  return (
    <main className="tool-page">
      <h1>Stats</h1>
      {error ? (
        <p role="alert">{String(error)}</p>
      ) : !rows ? (
        <p>Loading…</p>
      ) : (
        <table className="stats">
          <thead>
            <tr>
              <th>Type</th>
              <th>Published</th>
              <th>Drafts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type}>
                <td>{r.type}</td>
                <td>{r.published}</td>
                <td>{r.drafts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
