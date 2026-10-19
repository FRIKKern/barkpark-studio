// Over HTTP/1.1 (how `pnpm serve` answers) Chrome gives a site 6 connections, shared by
// all its tabs, and every studio tab held two open streams (live and presence): with a
// third tab open no connection was left, and saves waited for minutes
// (task-a346be1998fb2f16). A tab hidden for a while lets go of its streams and opens them
// again where it left off when it shows; the editor sees the catch-up in well under a second.
const RELEASE_MS = 30_000

/**
 * Calls `park` once the page has been hidden RELEASE_MS, and `resume` when it shows again
 * after a park. Returns the unsubscribe.
 */
export function onLongHidden(park: () => void, resume: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let parked = false
  const check = () => {
    clearTimeout(timer)
    if (document.visibilityState === 'hidden') {
      // e2e: a spec shortens the wait (window.__hiddenReleaseMs).
      const ms = (window as {__hiddenReleaseMs?: number}).__hiddenReleaseMs ?? RELEASE_MS
      timer = setTimeout(() => document.visibilityState === 'hidden' && !parked && ((parked = true), park()), ms)
    } else if (parked) (parked = false), resume()
  }
  document.addEventListener('visibilitychange', check)
  check()
  return () => (clearTimeout(timer), document.removeEventListener('visibilitychange', check))
}
