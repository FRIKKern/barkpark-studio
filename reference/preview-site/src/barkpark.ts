import {listeners, navigate} from './router'

// The Barkpark Studio side of the preview (J58–J63): a few postMessage events,
// where Sanity's Presentation uses comlink. Inside a studio's iframe this page says
// hello, where it is after every navigation and which documents it shows; the studio
// navigates it, asks for a refresh, picks the perspective (J63) and sends its unsaved
// edits to the documents on the page (J60). Messages from anything but a local studio
// are ignored.
const STUDIO = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

import type {Doc} from './bp-pages'

type Perspective = 'drafts' | 'published'
/** What the studio asked for; on its own the page shows what is published. */
export const studio = {
  perspective: (window.parent !== window ? 'drafts' : 'published') as Perspective,
  edits: new Map<string, Doc>(),
  listeners: new Set<() => void>(),
}
const changed = () => studio.listeners.forEach((l) => l())

/** J64: opened from a shared link (`?bp-share=`): that document's draft, laid over the page. */
export const shared = {state: 'none' as 'none' | 'loading' | 'on' | 'gone'}
export function openShared() {
  const token = new URLSearchParams(location.search).get('bp-share')
  if (!token || window.parent !== window) return
  shared.state = 'loading'
  fetch(`/api/bp/share?token=${encodeURIComponent(token)}`)
    .then((r) => (r.ok ? (r.json() as Promise<Doc>) : null))
    .then((doc) => {
      shared.state = doc ? 'on' : 'gone'
      if (doc) studio.edits.set(doc._id.replace(/^drafts\./, ''), doc)
      changed()
    })
}

const post = (msg: Record<string, unknown>) => window.parent !== window && window.parent.postMessage({bp: 'preview', ...msg}, '*')

/** The documents the page shows (after its location: the studio clears its list on a move). */
export function reportDocuments(documents: {_id: string; _type: string}[]) {
  post({type: 'documents', documents})
}

export function connectBarkpark() {
  if (window.parent === window) return
  const here = () => post({type: 'location', url: location.pathname + location.search, title: document.title})
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !STUDIO.test(e.origin) || e.data?.bp !== 'studio') return
    if (e.data.type === 'navigate' && typeof e.data.url === 'string') navigate(e.data.url)
    if (e.data.type === 'refresh') location.reload()
    if (e.data.type === 'perspective' && (e.data.perspective === 'drafts' || e.data.perspective === 'published') && e.data.perspective !== studio.perspective) {
      studio.perspective = e.data.perspective
      studio.edits.clear()
      changed()
    }
    const doc = e.data.doc as Doc | undefined
    if (e.data.type === 'doc' && doc && typeof doc._id === 'string' && studio.perspective === 'drafts') {
      studio.edits.set(doc._id.replace(/^drafts\./, ''), doc)
      changed()
    }
  })
  listeners.add(here)
  post({type: 'hello'})
  here()
}
