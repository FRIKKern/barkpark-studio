import {useEffect, useState} from 'react'
import {createServerFn} from '@tanstack/react-start'

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

const fetchSchemaFingerprint = createServerFn({method: 'GET'}).handler(async () => (await import('../server/schemas')).schemaFingerprint())

/**
 * Bad day: Barkpark's content model changes live (a field removed, a type changed) while
 * a tab has the old one. Asked like the build (every minute, and when the tab comes
 * back): true once it differs from the model this tab loaded, so the studio can say so
 * and offer a reload (Sanity: a schema change is a redeploy, its "New version available").
 */
export function useSchemaChanged(): boolean {
  const [changed, setChanged] = useState(false)
  useEffect(() => {
    let stop = false
    let first: string | undefined
    const ask = () =>
      fetchSchemaFingerprint()
        .then((f) => {
          if (stop) return
          if (first === undefined) first = f
          else if (f !== first) setChanged(true)
        })
        .catch(() => {}) // offline or refused: ask again later
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
  return changed
}
