import {listeners, navigate} from './router'

// The Barkpark Studio side of the preview (J58, J61): a few postMessage events,
// where Sanity's Presentation uses comlink. Inside a studio's iframe this page says
// hello, where it is after every navigation and which documents it shows; the studio
// can navigate it and ask for a refresh. Messages from anything but a local studio are ignored.
const STUDIO = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

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
  })
  listeners.add(here)
  post({type: 'hello'})
  here()
}
