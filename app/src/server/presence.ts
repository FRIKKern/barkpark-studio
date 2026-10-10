// The browser's presence stream (/api/presence GET), proxied to Barkpark's room. One
// response to the browser for the tab's life; the upstream under it is re-opened on a
// new Barkpark instance (server/boot.ts): the old one stays open and deaf while focus
// moves land on the new one. The new stream starts with `session` (the tab sends its
// focus again) and the room as it is now.
import '@tanstack/react-start/server-only'
import {onNewBoot} from './boot'

// e2e: upstreams opened before this are deaf, as on a drained instance.
let deafSince = 0
const enc = new TextEncoder()

/** `open` makes one upstream request; `first` is its first answer, opened under `ctrl`; `gone` is the browser leaving. */
export function presenceStream(open: (signal: AbortSignal) => Promise<Response>, first: Response, ctrl: AbortController, gone: AbortSignal) {
  let reader = first.body!.getReader()
  let opened = Date.now()
  let dec = new TextDecoder()
  let rest = ''
  let done = false
  let unwatch = () => {}
  let out: ReadableStreamDefaultController<Uint8Array>
  const end = () => {
    if (done) return
    done = true
    unwatch()
    ctrl.abort()
    try {
      out.close()
    } catch {
      // the browser already went
    }
  }
  return new ReadableStream<Uint8Array>({
    start(c) {
      out = c
      gone.addEventListener('abort', end)
      unwatch = onNewBoot(async () => {
        const next = new AbortController()
        const res = await open(next.signal).catch(() => null)
        // No new stream: close, and the browser's EventSource comes back on its own.
        if (done || !res?.ok || !res.body) return void (next.abort(), end())
        const old = ctrl
        ;(ctrl = next), (reader = res.body.getReader()), (opened = Date.now()), (dec = new TextDecoder()), (rest = '')
        old.abort()
      })
    },
    async pull(c) {
      for (;;) {
        const from = reader
        const r = await from.read().catch(() => null)
        if (from !== reader) continue // swapped while reading: go on with the new stream
        if (!r || r.done) return end()
        if (opened <= deafSince) continue
        // Whole events only, so a swap never splices half of one onto the next stream.
        rest += dec.decode(r.value, {stream: true})
        const cut = rest.lastIndexOf('\n\n') + 2
        if (cut < 2) continue
        c.enqueue(enc.encode(rest.slice(0, cut)))
        rest = rest.slice(cut)
        return
      }
    },
    cancel: end,
  })
}

/** e2e (STUDIO_E2E_HOOKS=1): every open presence upstream drops what Barkpark sends; a re-opened one hears. */
export const e2ePresenceDeaf = () => void (deafSince = Date.now())
