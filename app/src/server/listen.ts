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
//
// The upstream can die without a word: the connection goes silent and stays open
// until undici notices (10+ s), while writes happen. The hub then has nothing to
// replay. So it re-opens the upstream (resuming at Last-Event-ID, which makes
// Barkpark replay what was missed) when a browser comes back after a gap and the
// upstream has been quiet, when one of our own writes gets no echo, and after 45 s
// with no byte at all (Barkpark sends a keepalive every 30 s).
import '@tanstack/react-start/server-only'
import {bpFetch, scope} from './barkpark'
import type {Scope} from '../lib/scope'

type Subscriber = {ids: Set<string>; types: Set<string>; send: (frame: string) => void}

type Buffered = {id: number; docId: string; type?: string; frame: string}
const BUFFER = 2000

// One hub per token and scope: each editor listens as themself (their own access, their
// own rate bucket), an editor's tabs share one upstream, and a tab in another dataset
// (B02) gets its own: the scope is pinned when the hub is made, inside a request, so the
// reconnect loop never asks a request that is gone.
type Hub = {
  token: string
  scope: Scope
  subscribers: Set<Subscriber>
  upstream: AbortController | null
  lastEventId: string | null
  idleTimer?: ReturnType<typeof setTimeout>
  buffer: Buffered[]
  /** First event id this hub saw since it (re)connected without a gap; older is unknown. */
  knownFrom: number | null
  /** The current upstream request: aborting it makes the loop reconnect at once. */
  attempt: AbortController | null
  lastByte: number
  lastFrameFor: Map<string, number>
}

const QUIET_MS = 1000
const ECHO_MS = 3000
const SILENT_MS = 45_000
const hubs = new Map<string, Hub>()
const hubKey = (token: string, at: Scope) => `${token}|${at.workspace}/${at.project}/${at.dataset}`
const hubFor = (token: string): Hub => {
  const at = scope()
  const key = hubKey(token, at)
  let h = hubs.get(key)
  if (!h) hubs.set(key, (h = {token, scope: at, subscribers: new Set(), upstream: null, lastEventId: null, buffer: [], knownFrom: null, attempt: null, lastByte: 0, lastFrameFor: new Map()}))
  return h
}

const wants = (sub: Subscriber, docId: string, type?: string) => sub.ids.has(docId) || (!!type && sub.types.has(type))

/** The newest event id the hub holds (-1: none yet). Sent as the welcome's id. */
export const head = (token: string) => {
  const b = hubFor(token).buffer
  return b.length ? b[b.length - 1].id : -1
}

export const publishedId = (id: string) => (id.startsWith('drafts.') ? id.slice(7) : id)

export function subscribe(token: string, ids: string[], types: string[], send: Subscriber['send'], since?: number): () => void {
  const hub = hubFor(token)
  const {buffer, subscribers} = hub
  const knownFrom = hub.knownFrom
  const sub = {ids: new Set(ids.map(publishedId)), types: new Set(types), send}
  if (since !== undefined && Number.isFinite(since)) {
    // -1: the page had seen nothing yet when it was told the head (welcome) —
    // everything buffered is after that.
    if (since >= 0 && knownFrom !== null && since + 1 < knownFrom) send('event: reset\ndata: {}\n\n')
    else for (const b of buffer) if (b.id > since && wants(sub, b.docId, b.type)) send(b.frame)
  }
  subscribers.add(sub)
  clearTimeout(hub.idleTimer)
  if (!hub.upstream) void connect(hub)
  // A browser back after a gap: if the upstream has been quiet, it may be dead.
  else if (since !== undefined && Date.now() - hub.lastByte > QUIET_MS) refresh(hub)
  return () => {
    subscribers.delete(sub)
    if (subscribers.size === 0) {
      clearTimeout(hub.idleTimer)
      hub.idleTimer = setTimeout(() => {
        if (subscribers.size > 0) return
        hub.upstream?.abort()
        hub.upstream = null
      }, 60_000)
    }
  }
}

/** Re-open the upstream now, resuming at the last event id. */
function refresh(hub: Hub) {
  hub.attempt?.abort()
}

/** The doc ids a mutate batch writes ({patch: {id}}, {create: {_id}}, ...). */
export const mutatedIds = (mutations: unknown[]): string[] =>
  mutations.flatMap((m) => Object.values((m ?? {}) as Record<string, {id?: string; _id?: string}>).map((v) => v?.id ?? v?._id)).filter((x): x is string => typeof x === 'string')

/** After one of our writes: its frame should come back soon; if not, the upstream is dead. */
export function expectEcho(token: string, docIds: string[]) {
  const hub = hubs.get(hubKey(token, scope()))
  if (!hub?.upstream || !docIds.length) return
  const sent = Date.now()
  setTimeout(() => {
    if (docIds.some((id) => (hub.lastFrameFor.get(publishedId(id)) ?? 0) < sent)) refresh(hub)
  }, ECHO_MS).unref?.()
}

async function connect(hub: Hub) {
  const ctrl = new AbortController()
  hub.upstream = ctrl
  let delay = 500
  const watchdog = setInterval(() => Date.now() - hub.lastByte > SILENT_MS && refresh(hub), 5000)
  watchdog.unref?.()
  ctrl.signal.addEventListener('abort', () => clearInterval(watchdog))
  while (hub.upstream === ctrl) {
    const attempt = new AbortController()
    hub.attempt = attempt
    const stop = () => attempt.abort()
    ctrl.signal.addEventListener('abort', stop)
    try {
      const headers: Record<string, string> = {accept: 'text/event-stream'}
      if (hub.lastEventId) headers['last-event-id'] = hub.lastEventId
      const res = await bpFetch(`/v1/data/listen/${hub.scope.dataset}`, {headers, signal: attempt.signal}, hub.token, {at: hub.scope})
      if (!res.ok || !res.body) throw new Error(`listen ${res.status}`)
      hub.lastByte = Date.now()
      delay = 500
      await pump(hub, res.body)
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (!attempt.signal.aborted) console.error('[listen] upstream dropped, reconnecting:', (err as Error).message)
    } finally {
      ctrl.signal.removeEventListener('abort', stop)
    }
    // A refresh reconnects at once; a failure backs off.
    if (!attempt.signal.aborted) {
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 10_000)
    }
  }
}

async function pump(hub: Hub, body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of body) {
    hub.lastByte = Date.now()
    buf += decoder.decode(chunk, {stream: true})
    let end
    while ((end = buf.indexOf('\n\n')) !== -1) {
      dispatch(hub, buf.slice(0, end))
      buf = buf.slice(end + 2)
    }
  }
}

function dispatch(hub: Hub, frame: string) {
  const {buffer, subscribers} = hub
  let id: string | null = null
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (id) hub.lastEventId = id
  if (event !== 'mutation' || data.length === 0) return
  const payload = JSON.parse(data.join('\n')) as {documentId?: string; type?: string}
  if (!payload.documentId || !id) return
  const n = Number(id)
  if (buffer.length && n <= buffer[buffer.length - 1].id) return // replayed by upstream after a reconnect
  const docId = publishedId(payload.documentId)
  hub.lastFrameFor.set(docId, Date.now())
  if (hub.lastFrameFor.size > 5000) hub.lastFrameFor.clear()
  const out = `id: ${id}\nevent: mutation\ndata: ${data.join('\n')}\n\n`
  buffer.push({id: n, docId, type: payload.type, frame: out})
  if (buffer.length > BUFFER) {
    buffer.shift()
    hub.knownFrom = buffer[0].id
  }
  hub.knownFrom ??= n
  for (const sub of subscribers) if (wants(sub, docId, payload.type)) sub.send(out)
}
