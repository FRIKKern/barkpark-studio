import {createFileRoute} from '@tanstack/react-router'
import {requestToken} from '../../server/barkpark'
import {head, subscribe} from '../../server/listen'
import {clientGone} from '../../server/client-gone'
import {pipePresence} from '../../server/presence-pipe'
import {openStreams as open} from '../../server/stream-registry'

// One stream per tab (lib/stream.ts): the live frames of /api/listen and the presence
// room of /api/presence on a single SSE. Over HTTP/1.1 Chrome gives a site 6 connections
// across all its tabs; two streams a tab left a third visible tab none for its saves
// (task-a346be1998fb2f16). GET opens it (?ids=&types=&since=&resumed=1 as /api/listen,
// ?sessionId= as /api/presence) and names it in a `stream` event; POST {stream, ids,
// types, since} changes what it listens to without reopening it (a pane opened or closed).
const enc = new TextEncoder()
const PING_MS = 10_000
const PRESENCE_RETRY_MS = 2000

export const Route = createFileRoute('/api/stream')({
  server: {
    handlers: {
      GET: ({request}) => {
        const q = new URL(request.url).searchParams
        const list = (k: string) => (q.get(k) ?? '').split(',').filter(Boolean)
        const token = requestToken()
        // EventSource sends Last-Event-ID on its own reconnects (newest); ?since= is the
        // last id a page saw before it opened this stream.
        const since = Number(request.headers.get('last-event-id') ?? q.get('since') ?? NaN)
        const resumed = q.get('resumed') === '1' && !request.headers.get('last-event-id')
        const id = crypto.randomUUID()
        const gone = new AbortController()
        let cleanup = () => {}
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            const sendBytes = (b: Uint8Array) => {
              try {
                c.enqueue(b)
              } catch {}
            }
            const send = (s: string) => sendBytes(enc.encode(s))
            send('retry: 500\n\n')
            send(`event: stream\ndata: ${JSON.stringify({id})}\n\n`)
            // The welcome carries the stream position, so a page that has seen no frame
            // yet still knows where to resume from.
            send(`id: ${Number.isFinite(since) ? since : head(token)}\nevent: welcome\ndata: {}\n\n`)
            let unsubscribe = () => {}
            const listen = (ids: string[], types: string[], from?: number, again = false, latest = true) => {
              unsubscribe()
              unsubscribe = ids.length + types.length ? subscribe(token, ids, types, send, from, again, latest) : () => {}
            }
            // A page's first stream after its server render and a change of interests get each
            // document's last frame (lib/replay.ts); a stream opened again after a gap, every
            // frame it missed (F8).
            listen(list('ids'), list('types'), Number.isFinite(since) ? since : undefined, resumed, resumed)
            open.set(id, {token, listen: (ids, types, from) => listen(ids, types, from)})
            // Presence: Barkpark's room for this tab's session. Refused, it is asked again
            // here in a while (the live frames go on). Ended by Barkpark (the room dropped a
            // session that stopped beating: a sleeping tab) or by a new Barkpark boot, the
            // whole stream ends and the page opens it again itself, as with /api/presence: a
            // tab asleep stays out of the room until it wakes.
            const sessionId = q.get('sessionId')
            let presenceTimer: ReturnType<typeof setTimeout> | undefined
            const presence = () => {
              if (gone.signal.aborted) return
              const ended = () => {
                if (gone.signal.aborted) return
                cleanup()
                try {
                  c.close()
                } catch {}
              }
              void pipePresence(sessionId, gone.signal, sendBytes, ended).then((refused) => {
                if (refused && !gone.signal.aborted) presenceTimer = setTimeout(presence, PRESENCE_RETRY_MS)
              })
            }
            presence()
            // A named event, not a comment: EventSource hands comments to no one, and the
            // page needs to hear the stream is alive (lib/stream.ts reopens a quiet one).
            const ping = setInterval(() => send('event: ping\ndata: {}\n\n'), PING_MS)
            cleanup = () => {
              clearInterval(ping)
              clearTimeout(presenceTimer)
              unsubscribe()
              open.delete(id)
              gone.abort()
            }
            clientGone(request).addEventListener('abort', () => {
              cleanup()
              try {
                c.close()
              } catch {}
            })
          },
          cancel: () => cleanup(),
        })
        return new Response(stream, {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'}})
      },
      POST: async ({request}) => {
        const body = (await request.json().catch(() => ({}))) as {stream?: string; ids?: string[]; types?: string[]; since?: number | string | null}
        const s = body.stream ? open.get(body.stream) : undefined
        // Only the stream's own editor moves it (its id is random, and the token must match).
        if (!s || s.token !== requestToken()) return new Response('no such stream', {status: 404})
        const since = Number(body.since ?? NaN)
        s.listen(body.ids ?? [], body.types ?? [], Number.isFinite(since) ? since : undefined)
        return new Response(null, {status: 204})
      },
    },
  },
})
