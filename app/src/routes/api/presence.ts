import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset, requestToken} from '../../server/barkpark'
import {currentEditor} from '../../server/auth'
import {onNewBoot, presenceDeaf} from '../../server/listen'

// Editor presence (J07): Barkpark's room for this workspace + project + dataset, the
// same room its LiveView Studio joins. GET streams who is where (SSE, tracked while
// open); POST {sessionId, documentId, field} moves this tab's focus; DELETE ?sessionId=
// takes it out of the room at once (Barkpark #22563). All go out with the editor's own
// token, so the room names the editor and only they move or end their session.
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
        let off = () => {}
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('retry: 500\n\n')) // back within half a second
            // A Barkpark deploy: this stream stays on the instance being retired, alive and
            // deaf, while the room moves to the new one (the D11 caret flake, 02:07 UTC
            // 2026-10-10). A new boot ends it here; the tab's EventSource comes straight back.
            off = onNewBoot(() => {
              off()
              upstream.abort()
              try {
                c.close()
              } catch {}
            })
          },
          async pull(c) {
            const r = await reader.read().catch(() => null)
            if (!r || r.done) (off(), c.close())
            else if (!presenceDeaf) c.enqueue(r.value)
          },
          cancel: () => (off(), upstream.abort()),
        })
        return new Response(stream, {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'}})
      },
      DELETE: async ({request}) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (!sessionId) return new Response('sessionId required', {status: 400})
        // 404: already gone (left, or its stream closed): the same outcome.
        const res = await bpFetch(`/v1/data/presence/${dataset()}/leave?sessionId=${encodeURIComponent(sessionId)}`, {method: 'DELETE'}, requestToken(), {retry: false}).catch(() => null)
        return new Response(null, {status: res?.ok || res?.status === 404 ? 204 : (res?.status ?? 502)})
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

// Focus moves have a budget of their own on Barkpark, 600/min per token (barkpark#22283),
// apart from content writes. Coalesced per token to that pace: the latest per tab, sent
// at most once every FOCUS_FLUSH_MS, so a burst of Tab presses can't run it dry.
const FOCUS_FLUSH_MS = 100
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
      // No retry on 429: presence is best effort, and the next move sends where the caret is.
      void bpFetch(`/v1/data/presence/${dataset()}/focus`, {method: 'POST', headers: {'content-type': 'application/json'}, body: b}, token, {retry: false}).catch(() => {})
  }
  const wait = q.last + FOCUS_FLUSH_MS - Date.now()
  if (wait <= 0) flush()
  else q.timer = setTimeout(flush, wait)
}
