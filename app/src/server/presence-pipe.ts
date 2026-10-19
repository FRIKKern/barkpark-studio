import '@tanstack/react-start/server-only'
import {bpFetch, dataset} from './barkpark'
import {currentEditor, presenceName} from './auth'
import {onNewBoot, presenceDeafSince} from './listen'

// Editor presence (J07): Barkpark's room for this workspace + project + dataset, the
// same room its LiveView Studio joins, streamed with the editor's own token so the room
// names them. Used by /api/presence (a stream of its own) and /api/stream (one stream
// per tab, with the live frames).

const KEEPALIVE = ': keepalive\n\n'
/** Out of the room after this long with no focus: a tab asleep stops beating (lib/presence.ts). */
export const PRESENCE_STALE_S = 90
const PING = new TextEncoder().encode('event: ping\ndata: {}\n\n')
let piping = 0
/** e2e (soak): presence streams open to Barkpark now. */
export const presencePipes = () => piping

/**
 * Opens this editor's presence stream and hands its SSE bytes to `send` until `signal`
 * aborts, Barkpark closes it, or a new Barkpark boot retires it (`onEnd` then). Barkpark's
 * keepalive comment goes out as a `ping` event, which EventSource hands to the page.
 * Resolves with Barkpark's refusal when it doesn't open.
 */
export async function pipePresence(sessionId: string | null, signal: AbortSignal, send: (bytes: Uint8Array) => void, onEnd: () => void): Promise<Response | null> {
  const editor = currentEditor()
  const params = new URLSearchParams({name: editor ? presenceName(editor.email) : 'Studio'})
  if (sessionId) params.set('sessionId', sessionId)
  params.set('staleAfter', String(PRESENCE_STALE_S))
  const upstream = new AbortController()
  signal.addEventListener('abort', () => upstream.abort(), {once: true})
  const res = await bpFetch(`/v1/data/presence/${dataset()}?${params}`, {headers: {accept: 'text/event-stream'}, signal: upstream.signal}).catch(() => null)
  if (!res?.ok || !res.body) return res ?? new Response('presence unreachable', {status: 502})
  // A Barkpark deploy: this stream stays on the instance being retired, alive and deaf,
  // while the room moves to the new one (the D11 caret flake, 02:07 UTC 2026-10-10). A
  // new boot ends it here; the caller opens it again.
  const opened = Date.now() // e2e: a stream opened before the deaf lever stays deaf
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let ended = false
  piping++
  const end = () => {
    if (ended) return
    ended = true
    piping--
    off()
    upstream.abort()
    onEnd()
  }
  const off = onNewBoot(end)
  void (async () => {
    for (;;) {
      const r = await reader.read().catch(() => null)
      if (!r || r.done) return end()
      if (opened <= presenceDeafSince) continue
      send(dec.decode(r.value) === KEEPALIVE ? PING : r.value)
    }
  })()
  return null
}
