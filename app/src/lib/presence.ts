import {useEffect, useSyncExternalStore} from 'react'

// Who else is here (J07). One stream per tab into Barkpark's presence room (via
// /api/presence); this tab's own entry is left out. Focus follows the caret: the doc
// open in the last pane, and the field (its id is the field path) being edited.

export type Presence = {sessionId: string; name: string; color: string; documentId: string | null; field: string | null}

let others: Presence[] = []
let self: string | null = null
let focus: {documentId: string | null; field: string | null} = {documentId: null, field: null}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function sendFocus() {
  if (!self || !focus.documentId) return
  void fetch('/api/presence', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({sessionId: self, documentId: focus.documentId, field: focus.field}),
  }).catch(() => {}) // presence is best effort; the next focus change tries again
}

let timer: ReturnType<typeof setTimeout> | undefined
let sent = ''
/**
 * Where this tab is now. Sent once the caret settles (FOCUS_SETTLE_MS, latest wins):
 * Barkpark counts a focus move against the token's write budget (task-2c31de0cf6597d32),
 * so opening a doc and landing in its first field is one write, not two.
 */
export function reportFocus(documentId: string, field: string | null) {
  focus = {documentId, field}
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (sent === `${documentId}|${field}`) return
    sent = `${documentId}|${field}`
    sendFocus()
  }, FOCUS_SETTLE_MS)
}
const FOCUS_SETTLE_MS = 500

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
        sent = focus.documentId ? `${focus.documentId}|${focus.field}` : ''
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
    // Leaving: clear our focus at once. Barkpark takes 20-40 s to notice a closed
    // stream (task-936472b77285df5b), and avatars on someone's field should not outlive the tab.
    const leave = () => {
      if (self) navigator.sendBeacon('/api/presence', new Blob([JSON.stringify({sessionId: self, documentId: null, field: null})], {type: 'application/json'}))
    }
    addEventListener('pagehide', leave)
    open()
    return () => {
      stopped = true
      clearTimeout(retry)
      removeEventListener('pagehide', leave)
      es?.close()
    }
  }, [])
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
/** Everyone else in the room. */
export const usePresences = () => useSyncExternalStore(subscribe, () => others, () => others)
