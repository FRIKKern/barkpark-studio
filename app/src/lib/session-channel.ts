// task-72b3bac89b1c6161: signing out (or in) in one tab reaches this studio's other tabs at
// once, as Sanity's does; each asks the server who is signed in (components/SessionGate.tsx).
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bp-session')

/** Tell the other tabs the session changed here. */
export const announceSession = () => channel?.postMessage('changed')

/** Run `f` when another tab says the session changed; returns the unsubscribe. */
export function onSessionChange(f: () => void): () => void {
  channel?.addEventListener('message', f)
  return () => channel?.removeEventListener('message', f)
}
