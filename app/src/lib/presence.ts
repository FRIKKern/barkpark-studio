import {useEffect, useSyncExternalStore} from 'react'
import {withoutSelf} from './presence-people'

// Who else is here (J07). One stream per tab into Barkpark's presence room (via
// /api/presence); this tab's own entry is left out. Focus follows the caret: the doc
// open in the last pane, and the field (its id is the field path) being edited.

/** D11: a canvas caret, as bp-canvas-selection gives it (EMBED-CONTRACT "Shared carets"). */
export type CaretPoint = {blockId: string; path?: string; offset: number}
export type CaretSelection = {anchor: CaretPoint; head: CaretPoint}
export type Presence = {sessionId: string; name: string; color: string; documentId: string | null; field: string | null; selection?: CaretSelection | null}

let others: Presence[] = []
/** The navbar's people: `others` less this editor's own tabs once their presence name is known. */
let shown: Presence[] = []
let selfName: string | null = null
/**
 * J07, as Sanity's: the navbar's Who's online leaves the signed-in editor out, all their tabs.
 * Document, field and list presence leave out only this tab: your other tab shows where it is
 * (task-0d75ccc71054620a).
 */
export function setPresenceSelf(name: string | null) {
  if (name === selfName) return
  selfName = name
  shown = withoutSelf(others, selfName)
  emit()
}
/** When each session last moved (joined, or changed document or field): where a person is now (presence-people.ts). */
const moved = new Map<string, number>()
let self: string | null = null
let focus: {documentId: string | null; field: string | null; selection: CaretSelection | null} = {documentId: null, field: null, selection: null}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function sendFocus(beat = false) {
  if (!self || !(focus.documentId || beat)) return
  void fetch('/api/presence', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    // Barkpark clears a selection a focus move leaves out, so it rides along on every one.
    body: JSON.stringify({sessionId: self, ...focus}),
  }).catch(() => {}) // presence is best effort; the next focus change tries again
}

let timer: ReturnType<typeof setTimeout> | undefined
let sent = ''
/**
 * Where this tab is now. Sent once the caret settles (FOCUS_SETTLE_MS, latest wins), so
 * opening a doc and landing in its first field is one move, not two. Others see it in
 * about 0.6 s (Sanity: about 1.4 s).
 */
export function reportFocus(documentId: string, field: string | null) {
  focus = {documentId, field, selection: documentId === focus.documentId ? focus.selection : null}
  clearTimeout(timer)
  timer = setTimeout(push, FOCUS_SETTLE_MS)
}
const FOCUS_SETTLE_MS = 500

function push() {
  const now = JSON.stringify(focus)
  if (sent === now) return
  sent = now
  sendFocus()
}

let caretTimer: ReturnType<typeof setTimeout> | undefined
/**
 * D11: where the caret is in a canvas on `documentId` (null: it left). Others see it
 * as a caret with this editor's name: sent at most every CARET_FLUSH_MS, the latest.
 */
export function reportSelection(documentId: string, selection: CaretSelection | null) {
  if (focus.documentId !== documentId) focus = {documentId, field: null, selection}
  else focus = {...focus, selection}
  caretTimer ??= setTimeout(() => ((caretTimer = undefined), push()), CARET_FLUSH_MS)
}
const CARET_FLUSH_MS = 100

/** Mount once: keeps this tab in the room, reconnecting with the same session. */
export function usePresenceStream() {
  useEffect(() => {
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let heard = Date.now()
    let muted: EventSource | null = null // e2e: __mutePresence
    const open = () => {
      const stream = (es = new EventSource(`/api/presence${self ? `?sessionId=${encodeURIComponent(self)}` : ''}`))
      heard = Date.now()
      for (const name of ['ping', 'session', 'presence']) stream.addEventListener(name, (e) => e.target !== muted && (heard = Date.now()))
      es.addEventListener('session', (e) => {
        if (e.target === muted) return
        self = (JSON.parse((e as MessageEvent).data) as {sessionId: string}).sessionId
        sent = focus.documentId ? JSON.stringify(focus) : ''
        sendFocus()
      })
      es.addEventListener('presence', (e) => {
        if (e.target === muted) return
        const all = (JSON.parse((e as MessageEvent).data) as {presences: Presence[]}).presences
        const before = new Map(others.map((p) => [p.sessionId, p]))
        others = all.filter((p) => p.sessionId !== self)
        const now = Date.now()
        for (const p of others) {
          const was = before.get(p.sessionId)
          if (!was || was.documentId !== p.documentId || was.field !== p.field) moved.set(p.sessionId, now)
        }
        shown = withoutSelf(others, selfName)
        // e2e probe: this tab's session and the ones it sees (a spec tells one tab from another).
        Object.assign(window, {__presence: {self, others: others.map((p) => p.sessionId)}})
        emit()
      })
      es.onerror = () => {
        if (stopped || es?.readyState !== EventSource.CLOSED) return
        retry = setTimeout(open, 2000)
      }
    }
    // A stream that died without a word (a Wi-Fi switch, a sleep) stays open and hears
    // nothing: the room freezes as it was. Barkpark pings every 5 s; this long with no
    // event at all, or back on a network, the stream is reopened with the same session.
    let silentMs = 15_000
    const reopen = () => {
      if (stopped) return
      clearTimeout(retry)
      es?.close()
      open()
    }
    const watchdog = setInterval(() => Date.now() - heard > silentMs && reopen(), 1000)
    // A sleeping laptop keeps its socket, so Barkpark would show this tab for ~15 min after
    // it went to sleep. The room drops a session that sends no focus for PRESENCE_STALE_S
    // (api/presence.ts), so the tab re-sends its focus every BEAT_MS (Sanity reports every
    // 30 s); a hidden tab's timers run once a minute, still inside the window.
    const beat = setInterval(() => sendFocus(true), BEAT_MS)
    addEventListener('online', reopen)
    // e2e probe: the stream goes quiet without closing, and the tab calls it dead after `ms`.
    ;(window as {__mutePresence?: (ms: number) => void}).__mutePresence = (ms) => ((muted = es), (silentMs = ms))
    // Leaving (the tab goes, or the room's last view unmounts): out of the room at once
    // (Barkpark #22563's leave), not when its stream's next keepalive fails. keepalive:
    // the request outlives a closing page. One stream per tab, so a document switch is a
    // focus move, not a leave.
    const leave = () => {
      if (self) void fetch(`/api/presence?sessionId=${encodeURIComponent(self)}`, {method: 'DELETE', keepalive: true}).catch(() => {})
    }
    addEventListener('pagehide', leave)
    open()
    return () => {
      stopped = true
      clearTimeout(retry)
      clearInterval(watchdog)
      clearInterval(beat)
      removeEventListener('online', reopen)
      removeEventListener('pagehide', leave)
      leave()
      es?.close()
    }
  }, [])
}

const BEAT_MS = 30_000

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
/** Every other session in the room, this editor's other tabs too: for documents, fields and rows. */
export const usePresences = () => useSyncExternalStore(subscribe, () => others, () => others)
/** Everyone else in the studio, this editor's own tabs left out: for the navbar's Who's online. */
export const useOtherPeople = () => useSyncExternalStore(subscribe, () => shown, () => shown)
/** When each session last moved, for picking where a person with several tabs is now. */
export const lastMoved: ReadonlyMap<string, number> = moved
