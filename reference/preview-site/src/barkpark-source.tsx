import {useEffect, useState} from 'react'
import type {PageKey} from './App'
import {reportDocuments} from './barkpark'

declare const __SOURCE__: 'sanity' | 'barkpark'
export const SOURCE = __SOURCE__

// Inside a studio's preview the page shows drafts; on its own, what is published.
const perspective = () => (window.parent !== window ? 'drafts' : 'published')

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

export function BarkparkPage<T>({page, render}: {page: PageKey; render: (data: T) => React.ReactNode}) {
  const key = page.kind === 'post' ? page.slug : page.kind === 'author' ? page.id : ''
  const at = `${page.kind}:${key}`
  const [state, setState] = useState<{at: string; data: T} | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => onChange(() => setVersion((v) => v + 1)), [])
  useEffect(() => {
    let live = true
    fetch(`/api/bp/page?${new URLSearchParams({kind: page.kind, key, perspective: perspective()})}`)
      .then((r) => r.json())
      .then((out: {data: T; documents: {_id: string; _type: string}[]; error?: string}) => {
        if (!live) return
        if (out.error) return setError(out.error)
        setState({at, data: out.data})
        reportDocuments(out.documents)
      })
    return () => void (live = false)
  }, [at, version])
  if (error) return <p role="alert">Could not load: {error}</p>
  if (state?.at !== at) return <p className="meta">Loading…</p>
  return <>{render(state.data)}</>
}
