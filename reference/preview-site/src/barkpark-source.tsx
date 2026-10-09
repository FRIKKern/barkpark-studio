import {useEffect, useRef, useState, useSyncExternalStore} from 'react'
import type {PageKey} from './App'
import {reportDocuments, shared, studio} from './barkpark'
import {overlay, toPage, type Doc, type Raw} from './bp-pages'

declare const __SOURCE__: 'sanity' | 'barkpark'
export const SOURCE = __SOURCE__

// One stream for the tab. A change to a document on the page patches the page from
// the frame itself (it carries the whole document): no refetch, so another
// browser's edit shows as soon as it arrives (F4). Anything else refetches.
export type Frame = {mutation?: string; documentId?: string; result?: Doc}
const changed = new Set<(f: Frame) => void>()
let stream: EventSource | null = null
function onChange(fn: (f: Frame) => void) {
  changed.add(fn)
  if (!stream) {
    stream = new EventSource('/api/bp/listen')
    const ping = (e: MessageEvent) => {
      let frame: Frame = {}
      try {
        frame = JSON.parse(e.data)
      } catch {}
      changed.forEach((f) => f(frame))
    }
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
  const onPage = useRef<Set<string>>(new Set())
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(
    () =>
      onChange((frame) => {
        const doc = frame.result
        const pid = frame.documentId?.replace(/^drafts\./, '')
        const draft = !!frame.documentId?.startsWith('drafts.')
        const patchable = doc && pid && onPage.current.has(pid) && frame.mutation !== 'delete' && (studio.perspective === 'drafts' || !draft)
        if (!patchable) return setTick((v) => v + 1)
        // In drafts, a published copy never covers the draft the page shows.
        setState((st) => (st && (draft || studio.perspective === 'published' || !hasDraft(st.raw, pid)) ? {at: st.at, raw: overlay(st.raw, new Map([[pid, doc]]), true)} : st))
        // Then read the page again quietly: a changed reference gets its expanded copy.
        clearTimeout(settle.current)
        settle.current = setTimeout(() => setTick((v) => v + 1), 600)
      }),
    [],
  )
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
  onPage.current = new Set(shown?.documents.map((d) => d._id) ?? [])
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

/** Whether the page holds `id` as a draft. */
function hasDraft(value: unknown, id: string): boolean {
  if (Array.isArray(value)) return value.some((v) => hasDraft(v, id))
  if (!value || typeof value !== 'object') return false
  const d = value as Doc
  if (d._id === `drafts.${id}`) return true
  return Object.values(d).some((v) => hasDraft(v, id))
}
