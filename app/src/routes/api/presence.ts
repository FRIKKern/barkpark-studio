import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset, requestToken} from '../../server/barkpark'
import {currentEditor} from '../../server/auth'

// Editor presence (J07): Barkpark's room for this workspace + project + dataset, the
// same room its LiveView Studio joins. GET streams who is where (SSE, tracked while
// open); POST {sessionId, documentId, field} moves this tab's focus. Both go out with
// the editor's own token, so the room names the editor and focus is theirs to move.
export const Route = createFileRoute('/api/presence')({
  server: {
    handlers: {
      GET: async ({request}) => {
        const q = new URL(request.url).searchParams
        const params = new URLSearchParams({name: currentEditor()?.email.split('@')[0] ?? 'Studio'})
        const sessionId = q.get('sessionId')
        if (sessionId) params.set('sessionId', sessionId)
        const upstream = new AbortController()
        request.signal.addEventListener('abort', () => upstream.abort())
        const res = await bpFetch(`/v1/data/presence/${dataset()}?${params}`, {headers: {accept: 'text/event-stream'}, signal: upstream.signal})
        if (!res.ok || !res.body) return new Response(await res.text(), {status: res.status})
        // The tab going away must close Barkpark's stream at once: that is what takes
        // this editor out of the room (else it lingers until a keepalive write fails).
        const reader = res.body.getReader()
        const stream = new ReadableStream<Uint8Array>({
          async pull(c) {
            const r = await reader.read().catch(() => null)
            if (!r || r.done) c.close()
            else c.enqueue(r.value)
          },
          cancel: () => upstream.abort(),
        })
        return new Response(stream, {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'}})
      },
      POST: async ({request}) => {
        const body = (await request.json()) as {sessionId?: string}
        if (!body.sessionId) return new Response('sessionId required', {status: 400})
        queueFocus(requestToken(), body.sessionId, JSON.stringify(body))
        return new Response(null, {status: 202})
      },
    },
  },
})

// Barkpark bills a focus move as a write, from the same per-token budget as content
// (task-2c31de0cf6597d32). So focus moves are coalesced per token: the latest per tab,
// sent at most once every FOCUS_FLUSH_MS. Presence is best effort; content comes first.
const FOCUS_FLUSH_MS = 4000
const queues = new Map<string, {pending: Map<string, string>; last: number; timer?: ReturnType<typeof setTimeout>}>()

function queueFocus(token: string, sessionId: string, body: string) {
  let q = queues.get(token)
  if (!q) queues.set(token, (q = {pending: new Map(), last: 0}))
  q.pending.set(sessionId, body)
  if (q.timer) return
  const flush = () => {
    q.timer = undefined
    q.last = Date.now()
    const out = [...q.pending.values()]
    q.pending.clear()
    for (const b of out)
      // No retry on 429: a late focus is worth less than the content write it would delay.
      void bpFetch(`/v1/data/presence/${dataset()}/focus`, {method: 'POST', headers: {'content-type': 'application/json'}, body: b}, token, {retry: false}).catch(() => {})
  }
  const wait = q.last + FOCUS_FLUSH_MS - Date.now()
  if (wait <= 0) flush()
  else q.timer = setTimeout(flush, wait)
}
