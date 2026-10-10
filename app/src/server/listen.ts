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
// Barkpark replay what was missed; with no id yet, the pages are told to read
// again) when a browser comes back after a gap and the upstream has been quiet,
// when one of our own writes gets no echo, after 45 s with no byte at all
// (Barkpark sends a keepalive every 30 s), and when Barkpark answers from a newly
// booted instance (watchBoot below).
import '@tanstack/react-start/server-only'
import {bpFetch, forgetReads, forgetReadsOf, READ_DEDUPE_MS, scope} from './barkpark'
import type {Scope} from '../lib/scope'

type Subscriber = {ids: Set<string>; types: Set<string>; send: (frame: string) => void}

type Buffered = {id: number; docId: string; type?: string; frame: string; at: number}
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
  /** When the upstream first answered (0: not listening). A reconnect resumes at Last-Event-ID, so it stays live. */
  liveSince: number
  /** e2e: the stream hears nothing (it is on an instance being retired) until a new boot is seen. */
  deaf?: boolean
  /** e2e: no reconnect before this (a cut that lasts). */
  holdUntil?: number
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
  if (!h) hubs.set(key, (h = {token, scope: at, subscribers: new Set(), upstream: null, lastEventId: null, buffer: [], knownFrom: null, attempt: null, lastByte: 0, lastFrameFor: new Map(), liveSince: 0}))
  return h
}

const wants = (sub: Subscriber, docId: string, type?: string) => sub.ids.has(docId) || (!!type && sub.types.has(type))

/** The newest event id the hub holds (-1: none yet). Sent as the welcome's id. */
export const head = (token: string) => {
  const b = hubFor(token).buffer
  return b.length ? b[b.length - 1].id : -1
}

/**
 * Where a page rendered on the server resumes its stream (?since=); call it
 * before the page's reads. A listening hub answers as of READ_DEDUPE_MS ago (a
 * read may be a shared one from that long before; a frame replayed twice is
 * harmless). A hub not listening yet starts now, and the shared reads are dropped
 * so every read after this is newer than its first frame. Null only when Barkpark's
 * stream does not answer in time: the page then reads again once it connects.
 */
export async function resumeMark(token: string): Promise<number | null> {
  const hub = hubFor(token)
  const before = Date.now() - READ_DEDUPE_MS
  if (hub.upstream && hub.liveSince && hub.liveSince <= before) {
    for (let i = hub.buffer.length - 1; i >= 0; i--) if (hub.buffer[i].at <= before) return hub.buffer[i].id
    return -1 // every frame it holds came after: replay them all
  }
  if (!hub.upstream) {
    void connect(hub)
    if (hub.subscribers.size === 0) idleLater(hub)
  }
  for (const end = Date.now() + 1000; !hub.liveSince && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20))
  if (!hub.liveSince) return null
  forgetReads()
  return head(token)
}

export const publishedId = (id: string) => (id.startsWith('drafts.') ? id.slice(7) : id)

export function subscribe(token: string, ids: string[], types: string[], send: Subscriber['send'], since?: number, resumed = false): () => void {
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
  // Not for a page resuming from its server render: resumeMark just found the upstream live.
  else if (since !== undefined && !resumed && Date.now() - hub.lastByte > QUIET_MS) refresh(hub)
  return () => {
    subscribers.delete(sub)
    if (subscribers.size === 0) idleLater(hub)
  }
}

/** Close the upstream a minute after the last browser leaves (or none came). */
function idleLater(hub: Hub) {
  clearTimeout(hub.idleTimer)
  hub.idleTimer = setTimeout(() => {
    if (hub.subscribers.size > 0) return
    hub.upstream?.abort()
    hub.upstream = null
    hub.liveSince = 0
  }, 60_000)
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

// Barkpark deploys blue/green: once Caddy flips to the new instance the old one drains
// for some seconds, and a stream opened before the flip stays on it, keepalives and all,
// while every write lands on the new one. The hub then hears nothing (de6987a, 2026-10-09:
// ~25 s; the frames came late, replayed once the old instance closed the stream).
// status.json says when the instance answering it booted: a new boot re-opens every hub
// now, at its last event id, and Barkpark replays what the old stream missed.
const BOOT_CHECK_MS = 5000
let booted: number | null = null
let bootShift = 0
let bootTimer: ReturnType<typeof setInterval> | undefined
const onBoot = new Set<() => void>()
/** e2e: presence streams opened before this hear nothing (on an instance being retired); one re-opened after hears. */
export let presenceDeafSince = 0
/** Run `cb` when Barkpark answers from a newly booted instance (presence re-opens its stream then). */
export function onNewBoot(cb: () => void): () => void {
  onBoot.add(cb)
  watchBoot()
  return () => void onBoot.delete(cb)
}
function watchBoot() {
  if (bootTimer) return
  // From the first stream on, while any is open: the boot it started on is the baseline.
  const check = async () => {
    if (![...hubs.values()].some((h) => h.upstream) && !onBoot.size) return
    try {
      const s = (await (await fetch(`${process.env.BARKPARK_URL}/status.json`)).json()) as {checked_at?: string; uptime_seconds?: number}
      if (!s.checked_at || typeof s.uptime_seconds !== 'number') return
      const boot = Date.parse(s.checked_at) - s.uptime_seconds * 1000 + bootShift
      if (booted !== null && Math.abs(boot - booted) > 5000) {
        for (const h of hubs.values()) if (h.upstream) (h.deaf = false), refresh(h)
        for (const cb of [...onBoot]) cb()
      }
      booted = boot
    } catch {
      // Unreachable for a moment: the other checks still stand.
    }
  }
  bootTimer = setInterval(check, BOOT_CHECK_MS)
  bootTimer.unref?.()
  setTimeout(check, 0)
}

/** e2e (STUDIO_E2E_HOOKS=1): make every hub's (and presence) stream deaf, cut it for `ms`, or fake a newly booted instance. */
export function e2eListen(action: 'deaf' | 'cut' | 'flip', ms = 0) {
  if (action === 'flip') return void (bootShift += 60_000)
  if (action === 'deaf') presenceDeafSince = Date.now()
  for (const h of hubs.values()) {
    if (action === 'deaf') h.deaf = true
    else (h.holdUntil = Date.now() + ms), refresh(h)
  }
}

async function connect(hub: Hub) {
  watchBoot()
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
      while (hub.holdUntil && Date.now() < hub.holdUntil && !attempt.signal.aborted) await new Promise((r) => setTimeout(r, 50))
      const headers: Record<string, string> = {accept: 'text/event-stream'}
      if (hub.lastEventId) headers['last-event-id'] = hub.lastEventId
      // A re-open with no id to resume at (no frame since the hub connected, and the
      // welcome carries none): Barkpark replays nothing, so the gap is unknown and every
      // page reads again once the new stream answers.
      const blind = !hub.lastEventId && !!hub.liveSince
      const res = await bpFetch(`/v1/data/listen/${hub.scope.dataset}`, {headers, signal: attempt.signal}, hub.token, {at: hub.scope})
      // A dead token (401, Barkpark #22517) won't come back by itself: ask again once a minute, not every 10 s.
      if (res.status === 401) delay = 60_000
      if (!res.ok || !res.body) throw new Error(`listen ${res.status}`)
      hub.lastByte = Date.now()
      hub.liveSince ||= Date.now()
      delay = 500
      if (blind) for (const sub of hub.subscribers) sub.send('event: reset\ndata: {}\n\n')
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
      delay = delay >= 60_000 ? delay : Math.min(delay * 2, 10_000)
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
  if (hub.deaf) return
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
  // Another client's write too: a page reads the doc again on this frame, and a
  // shared read from just before it would hide the change (D22).
  forgetReadsOf(docId)
  hub.lastFrameFor.set(docId, Date.now())
  if (hub.lastFrameFor.size > 5000) hub.lastFrameFor.clear()
  const out = `id: ${id}\nevent: mutation\ndata: ${data.join('\n')}\n\n`
  buffer.push({id: n, docId, type: payload.type, frame: out, at: Date.now()})
  if (buffer.length > BUFFER) {
    buffer.shift()
    hub.knownFrom = buffer[0].id
  }
  hub.knownFrom ??= n
  for (const sub of subscribers) if (wants(sub, docId, payload.type)) sub.send(out)
}
