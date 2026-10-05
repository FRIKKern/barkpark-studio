import {createFileRoute} from '@tanstack/react-router'
import {head, subscribe} from '../../server/listen'

// GET /api/listen?ids=post-01,author-ada&types=post[&since=<event id>] → SSE of
// mutation frames for those docs (drafts included) and every doc of those types.
export const Route = createFileRoute('/api/listen')({
  server: {
    handlers: {
      GET: ({request}) => {
        const q = new URL(request.url).searchParams
        const ids = (q.get('ids') ?? '').split(',').filter(Boolean)
        const types = (q.get('types') ?? '').split(',').filter(Boolean)
        if (ids.length + types.length === 0) return new Response('ids or types required', {status: 400})
        // EventSource sends Last-Event-ID on its own reconnects (newest); ?since= is
        // the last id a page saw before it opened this subscription.
        const since = Number(request.headers.get('last-event-id') ?? q.get('since') ?? NaN)
        const enc = new TextEncoder()
        let cleanup = () => {}
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (s: string) => controller.enqueue(enc.encode(s))
            // The welcome carries the stream position, so a page that has seen no frame
            // yet still knows where to resume from.
            send(`id: ${Number.isFinite(since) ? since : head()}\nevent: welcome\ndata: {}\n\n`)
            const unsubscribe = subscribe(ids, types, send, Number.isFinite(since) ? since : undefined)
            const ping = setInterval(() => send(': ping\n\n'), 15_000)
            cleanup = () => {
              clearInterval(ping)
              unsubscribe()
            }
            request.signal.addEventListener('abort', () => {
              cleanup()
              try {
                controller.close()
              } catch {}
            })
          },
          cancel: () => cleanup(),
        })
        return new Response(stream, {
          headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'},
        })
      },
    },
  },
})
