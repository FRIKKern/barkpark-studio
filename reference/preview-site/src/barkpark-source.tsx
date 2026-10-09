import {useEffect, useState, useSyncExternalStore} from 'react'
import type {PageKey} from './App'
import {reportDocuments, shared, studio} from './barkpark'
import {overlay, toPage, type Raw} from './bp-pages'

declare const __SOURCE__: 'sanity' | 'barkpark'
export const SOURCE = __SOURCE__

// One stream for the tab: any change in the dataset refetches the page on screen.
const changed = new Set<() => void>()
let stream: EventSource | null = null
function onChange(fn: () => void) {
  changed.add(fn)
  if (!stream) {
    stream = new EventSource('/api/bp/listen')
    const ping = () => changed.forEach((f) => f())
    stream.addEventListener('mutation', ping)
    stream.onmessage = ping
  }
  return () => void changed.delete(fn)
}

// The studio's picks (perspective, unsaved edits) as one value that changes when they do.
let version = 0
studio.listeners.add(() => version++)
const useStudio = () => useSyncExternalStore((l) => (studio.listeners.add(l), () => studio.listeners.delete(l)), () => version)

export function BarkparkPage<T>({page, render}: {page: PageKey; render: (data: T) => React.ReactNode}) {
  const key = page.kind === 'post' ? page.slug : page.kind === 'author' ? page.id : ''
  const at = `${page.kind}:${key}`
  useStudio()
  const perspective = studio.perspective
  const [state, setState] = useState<{at: string; raw: Raw} | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => onChange(() => setTick((v) => v + 1)), [])
  useEffect(() => {
    let live = true
    fetch(`/api/bp/page?${new URLSearchParams({kind: page.kind, key, perspective})}`)
      .then((r) => r.json())
      .then((out: {raw: Raw; error?: string}) => {
        if (!live) return
        if (out.error) return setError(out.error)
        setState({at: `${at}|${perspective}`, raw: out.raw})
      })
    return () => void (live = false)
  }, [at, perspective, tick])
  // A perspective switch keeps the page on screen until the other one arrives.
  const shown = state?.at.startsWith(`${at}|`) ? toPage(page.kind, overlay(state.raw, studio.edits)) : null
  const ids = shown?.documents.map((d) => d._id).join(',')
  useEffect(() => void (shown && reportDocuments(shown.documents)), [ids, at])
  if (error) return <p role="alert">Could not load: {error}</p>
  if (!shown) return <p className="meta">Loading…</p>
  return <>{render(shown.data as T)}</>
}

/** A shared link says what it shows, or that it no longer works. */
export function SharedBanner() {
  useStudio()
  if (shared.state === 'on') return <div className="banner">Preview of unpublished changes</div>
  if (shared.state === 'gone') return <div className="banner">This preview link has expired or was turned off.</div>
  return null
}
