import {useEffect, useSyncExternalStore} from 'react'
import {withoutSelf} from './presence-people'
import {isParked, onPark, onStream, presenceSession} from './stream'

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

/** Mount once: keeps this tab in the room, on the tab's one stream (lib/stream.ts), rejoining with the same session. */
export function usePresenceStream() {
  useEffect(() => {
    const offs = [
      onStream('session', (e) => {
        self = (JSON.parse(e.data) as {sessionId: string}).sessionId
        sent = focus.documentId ? JSON.stringify(focus) : ''
        sendFocus()
      }),
      onStream('presence', (e) => {
        const all = (JSON.parse(e.data) as {presences: Presence[]}).presences
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
      }),
    ]
    // Leaving (the tab goes, or the room's last view unmounts): out of the room at once
    // (Barkpark #22563's leave), not when its stream's next keepalive fails. keepalive:
    // the request outlives a closing page. One session per tab, so a document switch is a
    // focus move, not a leave.
    const leave = () => {
      if (self) void fetch(`/api/presence?sessionId=${encodeURIComponent(self)}`, {method: 'DELETE', keepalive: true}).catch(() => {})
    }
    // Hidden a while, the tab let its stream go: out of the room now (shown again, the
    // stream rejoins with the same session and the 'session' event re-sends the focus).
    offs.push(onPark((parked) => parked && leave()))
    // A sleeping laptop keeps its socket, so Barkpark would show this tab for ~15 min after
    // it went to sleep. The room drops a session that sends no focus for 90 s
    // (server/presence-pipe.ts), so the tab re-sends its focus every BEAT_MS (Sanity
    // reports every 30 s); a hidden tab's timers run once a minute, still inside the window.
    const beat = setInterval(() => !isParked() && sendFocus(true), BEAT_MS)
    addEventListener('pagehide', leave)
    const release = presenceSession(() => self)
    return () => {
      clearInterval(beat)
      removeEventListener('pagehide', leave)
      offs.forEach((off) => off())
      leave()
      release()
    }
  }, [])
}

const BEAT_MS = 30_000

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
/** Every other session in the room, this editor's other tabs too: for documents, fields and rows. */
// The server draws nobody, so hydration starts from nobody too (NONE): presence frames that
// came before hydration drew avatars the server hadn't, and React threw "Hydration failed"
// and drew the whole pane again (the rig's error listener caught it in the many-tabs test).
const NONE: Presence[] = []
export const usePresences = () => useSyncExternalStore(subscribe, () => others, () => NONE)
/** Everyone else in the studio, this editor's own tabs left out: for the navbar's Who's online. */
export const useOtherPeople = () => useSyncExternalStore(subscribe, () => shown, () => NONE)
/** When each session last moved, for picking where a person with several tabs is now. */
export const lastMoved: ReadonlyMap<string, number> = moved
