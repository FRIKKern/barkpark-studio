import {useSyncExternalStore} from 'react'

// J20: a document's footer says it is offline ("Offline — not saving. Your edits are kept
// here."). The studio-wide "Trying to connect…" toast would then say it twice; Sanity shows
// one status. Its own module: lib/edits.ts writes it, lib/connection.ts reads it, and those
// two must not import each other (data.ts imports connection.ts).
let offline = false
const listeners = new Set<() => void>()
export function setFooterOffline(now: boolean) {
  if (now === offline) return
  offline = now
  listeners.forEach((l) => l())
}
export const useFooterOffline = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => offline,
    () => false,
  )
