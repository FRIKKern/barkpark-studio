import {useEffect, useSyncExternalStore} from 'react'

// Who else is here (J07). One stream per tab into Barkpark's presence room (via
// /api/presence); this tab's own entry is left out. Focus follows the caret: the doc
// open in the last pane, and the field (its id is the field path) being edited.

/** D11: a canvas caret, as bp-canvas-selection gives it (EMBED-CONTRACT "Shared carets"). */
export type CaretPoint = {blockId: string; path?: string; offset: number}
export type CaretSelection = {anchor: CaretPoint; head: CaretPoint}
export type Presence = {sessionId: string; name: string; color: string; documentId: string | null; field: string | null; selection?: CaretSelection | null}

let others: Presence[] = []
let self: string | null = null
let focus: {documentId: string | null; field: string | null; selection: CaretSelection | null} = {documentId: null, field: null, selection: null}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function sendFocus() {
  if (!self || !focus.documentId) return
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
    const open = () => {
      es = new EventSource(`/api/presence${self ? `?sessionId=${encodeURIComponent(self)}` : ''}`)
      es.addEventListener('session', (e) => {
        self = (JSON.parse((e as MessageEvent).data) as {sessionId: string}).sessionId
        sent = focus.documentId ? JSON.stringify(focus) : ''
        sendFocus()
      })
      es.addEventListener('presence', (e) => {
        const all = (JSON.parse((e as MessageEvent).data) as {presences: Presence[]}).presences
        others = all.filter((p) => p.sessionId !== self)
        emit()
      })
      es.onerror = () => {
        if (stopped || es?.readyState !== EventSource.CLOSED) return
        retry = setTimeout(open, 2000)
      }
    }
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
      removeEventListener('pagehide', leave)
      leave()
      es?.close()
    }
  }, [])
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
/** Everyone else in the room. */
export const usePresences = () => useSyncExternalStore(subscribe, () => others, () => others)
