import {setLiveDown} from './connection'
import {onLongHidden} from './hidden'

// One stream per tab (/api/stream): the live frames (lib/live.ts) and the presence room
// (lib/presence.ts) share one EventSource. Over HTTP/1.1 Chrome gives a site 6
// connections across all its tabs, and two streams a tab left a third visible tab none
// for its saves (task-a346be1998fb2f16); with one, five visible tabs still save. What the
// panes listen to changes with a POST to the open stream, not a new one, so the presence
// session never blinks out on a navigation.

type Handler = (e: MessageEvent) => void
const handlers = new Map<string, Set<Handler>>()
const NAMES = ['stream', 'welcome', 'ping', 'mutation', 'reset', 'session', 'presence']

/** Hear one named event of the tab's stream. Returns the unsubscribe. */
export function onStream(name: string, h: Handler): () => void {
  if (!handlers.has(name)) handlers.set(name, new Set())
  handlers.get(name)!.add(h)
  return () => void handlers.get(name)!.delete(h)
}

/**
 * Where the live frames resume: the newest id this page has applied. A stream opened
 * later asks the server for everything since, so nothing falls between two streams.
 */
export const position: {lastSeen: string | null; fromRender: boolean} = {lastSeen: null, fromRender: false}

// What the tab's panes listen to: every useLive's ids and types, as one subscription.
const interests = new Set<{ids: string[]; types: string[]}>()
const wanted = () => {
  const ids = new Set<string>()
  const types = new Set<string>()
  for (const i of interests) i.ids.forEach((x) => ids.add(x)), i.types.forEach((x) => types.add(x))
  return {ids: [...ids].sort(), types: [...types].sort()}
}
let sentKey = ''
let syncQueued = false
/** Listen to these docs and types while mounted. Returns the release. */
export function listenTo(ids: string[], types: string[]): () => void {
  const interest = {ids, types}
  interests.add(interest)
  queueSync()
  start()
  return () => {
    interests.delete(interest)
    queueSync()
    stopLater()
  }
}
// One POST per burst of pane changes, after React has run every effect of the render.
function queueSync() {
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(() => {
    syncQueued = false
    const w = wanted()
    const key = `${w.ids.join(',')}|${w.types.join(',')}`
    if (key === sentKey || !es || !streamId) return
    sentKey = key
    void fetch('/api/stream', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({stream: streamId, ...w, since: position.lastSeen})}).then(
      (r) => r.status === 404 && reopen(), // the stream is gone (a server restart): open a new one with all of it
      () => {},
    )
  })
}

let sessionOf: () => string | null = () => null
let presenceWanted = false
/** presence.ts: the tab's presence session for the stream's URL (it rejoins with it). */
export function presenceSession(get: () => string | null): () => void {
  sessionOf = get
  presenceWanted = true
  start()
  return () => ((presenceWanted = false), stopLater())
}

let es: EventSource | null = null
let streamId: string | null = null
let parked = false
let retry: ReturnType<typeof setTimeout> | undefined
let heard = 0
let silentMs = 20_000
let muted: EventSource | null = null // e2e: __muteLive / __mutePresence
let watchdog: ReturnType<typeof setInterval> | undefined
let unhide = () => {}
const parkers = new Set<(parked: boolean) => void>()
/** Told when the tab, hidden a while, lets the stream go (true) and when it opens it again (false). */
export function onPark(cb: (parked: boolean) => void): () => void {
  parkers.add(cb)
  return () => void parkers.delete(cb)
}
export const isParked = () => parked

let openedKey = ''
function open() {
  const w = wanted()
  sentKey = openedKey = `${w.ids.join(',')}|${w.types.join(',')}`
  const q = new URLSearchParams()
  if (w.ids.length) q.set('ids', w.ids.join(','))
  if (w.types.length) q.set('types', w.types.join(','))
  if (position.lastSeen) q.set('since', position.lastSeen)
  if (position.fromRender) q.set('resumed', '1')
  position.fromRender = false
  const session = presenceWanted ? sessionOf() : null
  if (session) q.set('sessionId', session)
  const stream = (es = new EventSource(`/api/stream?${q}`))
  streamId = null
  heard = Date.now()
  for (const name of NAMES)
    stream.addEventListener(name, (e) => {
      if (stream !== es || stream === muted) return
      heard = Date.now()
      if (name === 'stream') {
        streamId = (JSON.parse((e as MessageEvent).data) as {id: string}).id
        // The server listens to what the URL said (EventSource reconnects by itself with
        // the URL it opened): panes opened or closed since go to it now.
        sentKey = openedKey
        return queueSync()
      }
      if (name === 'mutation' && (e as MessageEvent).lastEventId) position.lastSeen = (e as MessageEvent).lastEventId
      if (name === 'welcome') setLiveDown(false)
      handlers.get(name)?.forEach((h) => h(e as MessageEvent))
    })
  // EventSource retries a dropped stream by itself (sending Last-Event-ID); one it gave
  // up on (CLOSED) is reopened here.
  stream.onerror = () => {
    if (stream !== es) return
    setLiveDown(true) // J50: "Trying to connect…" if it stays down
    if (stream.readyState === EventSource.CLOSED && !parked) retry = setTimeout(open, 1000)
  }
}

/** Close the stream and open it again where it left off (a dead or silent one). */
function reopen() {
  if (!es || parked) return
  clearTimeout(retry)
  es.close()
  setLiveDown(true)
  open()
}

let stopTimer: ReturnType<typeof setTimeout> | undefined
function start() {
  if (typeof window === 'undefined') return
  clearTimeout(stopTimer)
  if (es || parked) return
  open()
  // A stream can die without a word (a Wi-Fi switch, a sleep, a proxy dropping an idle
  // connection): it stays open and hears nothing. The server pings every 10 s and
  // Barkpark's presence every 5 s; this long with no event at all, it opens again.
  watchdog = setInterval(() => Date.now() - heard > silentMs && reopen(), 1000)
  addEventListener('online', reopen)
  // Hidden a while, the tab lets the stream go (lib/hidden.ts); shown, it opens again.
  unhide = onLongHidden(
    () => {
      parked = true
      clearTimeout(retry)
      es?.close()
      es = null
      streamId = null
      setLiveDown(false)
      parkers.forEach((p) => p(true))
    },
    () => {
      parked = false
      parkers.forEach((p) => p(false))
      open()
    },
  )
}
// The last user gone (a page with no panes and no presence): close after this render.
function stopLater() {
  clearTimeout(stopTimer)
  stopTimer = setTimeout(() => {
    if (interests.size || presenceWanted) return
    clearInterval(watchdog)
    clearTimeout(retry)
    removeEventListener('online', reopen)
    unhide()
    es?.close()
    es = null
    streamId = null
    parked = false
    setLiveDown(false)
  }, 0)
}

if (typeof window !== 'undefined') {
  const w = window as {__muteLive?: (ms: number) => void; __mutePresence?: (ms: number) => void; __dropLive?: (ms: number) => void}
  // e2e probe: the stream goes quiet without closing (what a dropped network does), and
  // the page calls it dead after `ms` of nothing.
  w.__muteLive = w.__mutePresence = (ms) => ((muted = es), (silentMs = ms))
  // e2e probe: cut the stream for `ms`, as a dead network would.
  w.__dropLive = (ms) => {
    es?.close()
    es = null
    clearTimeout(retry)
    retry = setTimeout(open, ms)
  }
}
