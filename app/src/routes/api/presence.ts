import {createFileRoute} from '@tanstack/react-router'
import {bpFetch, dataset, requestToken} from '../../server/barkpark'
import {clientGone} from '../../server/client-gone'
import {pipePresence} from '../../server/presence-pipe'

// Editor presence (J07): Barkpark's room for this workspace + project + dataset, the
// same room its LiveView Studio joins. GET streams who is where (SSE, tracked while
// open); POST {sessionId, documentId, field} moves this tab's focus; DELETE ?sessionId=
// takes it out of the room at once (Barkpark #22563). All go out with the editor's own
// token, so the room names the editor and only they move or end their session.
export const Route = createFileRoute('/api/presence')({
  server: {
    handlers: {
      GET: async ({request}) => {
        let c!: ReadableStreamDefaultController<Uint8Array>
        const out = new ReadableStream<Uint8Array>({start: (ctrl) => void (c = ctrl), cancel: () => upstream.abort()})
        const upstream = new AbortController()
        // The tab going away must close Barkpark's stream at once: that is what takes
        // this editor out of the room (else it lingers until a keepalive write fails).
        clientGone(request).addEventListener('abort', () => upstream.abort(), {once: true})
        c.enqueue(new TextEncoder().encode('retry: 500\n\n')) // back within half a second
        const send = (b: Uint8Array) => {
          try {
            c.enqueue(b)
          } catch {}
        }
        const end = () => {
          try {
            c.close()
          } catch {}
        }
        const refused = await pipePresence(new URL(request.url).searchParams.get('sessionId'), upstream.signal, send, end)
        if (refused) return new Response(await refused.text(), {status: refused.status})
        return new Response(out, {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'}})
      },
      DELETE: async ({request}) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (!sessionId) return new Response('sessionId required', {status: 400})
        queues.get(requestToken())?.latest.delete(sessionId) // gone: nothing of it goes again
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
const queues = new Map<string, {pending: Map<string, string>; latest: Map<string, string>; last: number; timer?: ReturnType<typeof setTimeout>}>()
const FOCUS_RETRY_MS = 1000

function queueFocus(token: string, sessionId: string, body: string) {
  let q = queues.get(token)
  if (!q) queues.set(token, (q = {pending: new Map(), latest: new Map(), last: 0}))
  q.pending.set(sessionId, body)
  q.latest.set(sessionId, body)
  if (q.timer) return
  const flush = () => {
    q.timer = undefined
    q.last = Date.now()
    const out = [...q.pending]
    q.pending.clear()
    for (const [sid, b] of out)
      // Over the budget (429): where this tab is now goes again after a beat, unless it has
      // moved since (that move is sent instead). Else a caret that came to rest stays a step
      // behind for the others until it moves again.
      void bpFetch(`/v1/data/presence/${dataset()}/focus`, {method: 'POST', headers: {'content-type': 'application/json'}, body: b}, token, {retry: false})
        .then((r) => r.status === 429 && setTimeout(() => q.latest.get(sid) === b && !q.pending.has(sid) && queueFocus(token, sid, b), FOCUS_RETRY_MS))
        .catch(() => {})
  }
  const wait = q.last + FOCUS_FLUSH_MS - Date.now()
  if (wait <= 0) flush()
  else q.timer = setTimeout(flush, wait)
}
