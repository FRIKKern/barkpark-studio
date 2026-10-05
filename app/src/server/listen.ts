// One upstream SSE connection per server process, fanned out to browser
// subscribers filtered by document id / type. Barkpark's listen stream is per
// dataset; the browser only ever sees frames for what it asked for.
//
// Reconnects lose nothing: the hub keeps the last frames, and a browser that
// comes back (EventSource sends Last-Event-ID; a new subscription passes
// ?since=) gets every matching frame after its last one, in order, before live
// ones. If its last frame is older than the buffer, it is told to `reset`
// (refetch). The upstream stays open a minute after the last browser leaves, so
// a browser that drops for a while doesn't take the history with it.
import '@tanstack/react-start/server-only'
import {bpFetch, dataset} from './barkpark'

type Subscriber = {ids: Set<string>; types: Set<string>; send: (frame: string) => void}

const subscribers = new Set<Subscriber>()
let upstream: AbortController | null = null
let lastEventId: string | null = null
let idleTimer: ReturnType<typeof setTimeout> | undefined

type Buffered = {id: number; docId: string; type?: string; frame: string}
const BUFFER = 2000
const buffer: Buffered[] = []
/** First event id this hub saw since it (re)connected without a gap; older is unknown. */
let knownFrom: number | null = null

const wants = (sub: Subscriber, docId: string, type?: string) => sub.ids.has(docId) || (!!type && sub.types.has(type))

/** The newest event id the hub holds (-1: none yet). Sent as the welcome's id. */
export const head = () => (buffer.length ? buffer[buffer.length - 1].id : -1)

export const publishedId = (id: string) => (id.startsWith('drafts.') ? id.slice(7) : id)

export function subscribe(ids: string[], types: string[], send: Subscriber['send'], since?: number): () => void {
  const sub = {ids: new Set(ids.map(publishedId)), types: new Set(types), send}
  if (since !== undefined && Number.isFinite(since)) {
    // -1: the page had seen nothing yet when it was told the head (welcome) —
    // everything buffered is after that.
    if (since >= 0 && knownFrom !== null && since + 1 < knownFrom) send('event: reset\ndata: {}\n\n')
    else for (const b of buffer) if (b.id > since && wants(sub, b.docId, b.type)) send(b.frame)
  }
  subscribers.add(sub)
  clearTimeout(idleTimer)
  if (!upstream) void connect()
  return () => {
    subscribers.delete(sub)
    if (subscribers.size === 0) {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (subscribers.size > 0) return
        upstream?.abort()
        upstream = null
      }, 60_000)
    }
  }
}

async function connect() {
  const ctrl = new AbortController()
  upstream = ctrl
  let delay = 500
  while (upstream === ctrl) {
    try {
      const headers: Record<string, string> = {accept: 'text/event-stream'}
      if (lastEventId) headers['last-event-id'] = lastEventId
      const res = await bpFetch(`/v1/data/listen/${dataset()}`, {headers, signal: ctrl.signal})
      if (!res.ok || !res.body) throw new Error(`listen ${res.status}`)
      delay = 500
      await pump(res.body)
    } catch (err) {
      if (ctrl.signal.aborted) return
      console.error('[listen] upstream dropped, reconnecting:', (err as Error).message)
    }
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(delay * 2, 10_000)
  }
}

async function pump(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of body) {
    buf += decoder.decode(chunk, {stream: true})
    let end
    while ((end = buf.indexOf('\n\n')) !== -1) {
      dispatch(buf.slice(0, end))
      buf = buf.slice(end + 2)
    }
  }
}

function dispatch(frame: string) {
  let id: string | null = null
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (id) lastEventId = id
  if (event !== 'mutation' || data.length === 0) return
  const payload = JSON.parse(data.join('\n')) as {documentId?: string; type?: string}
  if (!payload.documentId || !id) return
  const n = Number(id)
  if (buffer.length && n <= buffer[buffer.length - 1].id) return // replayed by upstream after a reconnect
  const docId = publishedId(payload.documentId)
  const out = `id: ${id}\nevent: mutation\ndata: ${data.join('\n')}\n\n`
  buffer.push({id: n, docId, type: payload.type, frame: out})
  if (buffer.length > BUFFER) {
    buffer.shift()
    knownFrom = buffer[0].id
  }
  knownFrom ??= n
  for (const sub of subscribers) if (wants(sub, docId, payload.type)) sub.send(out)
}
