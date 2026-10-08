import {useEffect, useState} from 'react'

// J53, Sanity's "New version available": the tab knows the build it loaded; the
// server says which one it runs now. They differ after a redeploy, and the help
// menu offers "Reload to update". Asked every minute and when the tab comes back.
export const BUILD = __STUDIO_BUILD__
const EVERY_MS = 60_000

/** A build's short name, as the menu shows it: its commit ("8c7f965"). */
export const buildName = (b: string) => b.split('-')[0]!

/** The newer build the server runs, or null while this tab is current. */
export function useNewVersion(): string | null {
  const [next, setNext] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    const ask = () =>
      fetch('/api/version', {cache: 'no-store'})
        .then((r) => (r.ok ? (r.json() as Promise<{build?: string}>) : null))
        .then((v) => !stop && v?.build && setNext(v.build !== BUILD ? v.build : null))
        .catch(() => {}) // offline: ask again later
    const visible = () => document.visibilityState === 'visible' && void ask()
    void ask()
    const timer = setInterval(ask, EVERY_MS)
    addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      stop = true
      clearInterval(timer)
      removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  return next
}
