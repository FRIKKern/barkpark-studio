import {useEffect, useState} from 'react'
import {createFileRoute} from '@tanstack/react-router'

// Proves the live path: `bp doc patch post <id> --set excerpt=<epoch ms>` and
// this page shows the frame and the delay from that timestamp to arrival.
export const Route = createFileRoute('/debug/live')({
  validateSearch: (s: Record<string, unknown>) => ({id: typeof s.id === 'string' ? s.id : 'post-01'}),
  component: Live,
})

type Frame = {at: number; eventId: string; documentId: string; rev: string; excerpt: unknown; latencyMs: number | null}

function Live() {
  const {id} = Route.useSearch()
  const [status, setStatus] = useState('connecting')
  const [frames, setFrames] = useState<Frame[]>([])

  useEffect(() => {
    const es = new EventSource(`/api/listen?ids=${encodeURIComponent(id)}`)
    es.addEventListener('welcome', () => setStatus('live'))
    es.addEventListener('mutation', (e) => {
      const at = performance.timeOrigin + performance.now()
      const m = JSON.parse((e as MessageEvent).data)
      const sent = Number(String(m.result?.excerpt ?? '').match(/\d{13}/)?.[0])
      setFrames((f) =>
        [
          {
            at,
            eventId: m.eventId,
            documentId: m.documentId,
            rev: m.rev,
            excerpt: m.result?.excerpt,
            latencyMs: sent ? Math.round(at - sent) : null,
          },
          ...f,
        ].slice(0, 20),
      )
    })
    es.onerror = () => setStatus('reconnecting')
    return () => es.close()
  }, [id])

  return (
    <main>
      <h1>Live: {id}</h1>
      <p data-testid="status">{status}</p>
      <table data-testid="frames">
        <thead>
          <tr>
            <th>event</th>
            <th>doc</th>
            <th>excerpt</th>
            <th>latency</th>
          </tr>
        </thead>
        <tbody>
          {frames.map((f) => (
            <tr key={f.eventId}>
              <td>{f.eventId}</td>
              <td>{f.documentId}</td>
              <td>{String(f.excerpt)}</td>
              <td data-testid="latency">{f.latencyMs === null ? '–' : `${f.latencyMs} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
