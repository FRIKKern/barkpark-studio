import {useEffect, useRef, useState} from 'react'
import type {Doc} from '../lib/data'
import {previewUrlOf, slugOf} from '../lib/preview-url'

// The "Forhåndsvisning" document view, as the Agency Studio's preview-pane.tsx draws it:
// the site in an iframe, reloaded 800 ms after the document changes. The URL is the
// schema's desk.preview template with :slug and :id filled in.

const s = {width: 25, height: 25, viewBox: '0 0 25 25', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2} as const

/** Sanity's EditIcon: the form view's tab icon. */
export const EditIcon = () => (
  <svg {...s} aria-hidden="true">
    <path d="M15 7l3 3M6 19l1-4L17 5l3 3-10 10-4 1z" />
  </svg>
)
/** Sanity's EyeOpenIcon: the preview view's tab icon. */
export const EyeOpenIcon = () => (
  <svg {...s} aria-hidden="true">
    <path d="M9.4 12.5a3.1 3.1 0 1 0 6.2 0 3.1 3.1 0 1 0-6.2 0z" />
    <path d="M12.5 7.5c-4 0-6.5 2.5-8 5 1.5 2.5 4 5 8 5s6.5-2.5 8-5c-1.5-2.5-4-5-8-5z" />
  </svg>
)

export function PreviewView({template, doc, id}: {template: string; doc: Doc; id: string}) {
  const url = previewUrlOf(template, id, slugOf(doc))
  // Reload shortly after the document changes, like Agency's listener does.
  const [reload, setReload] = useState(0)
  const first = useRef(true)
  const rev = `${doc._rev ?? ''}:${doc._updatedAt ?? ''}`
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const timer = setTimeout(() => setReload((n) => n + 1), 800)
    return () => clearTimeout(timer)
  }, [rev])
  if (!url) return <p className="muted preview-view-message">Legg til en URL for å aktivere forhåndsvisning.</p>
  const src = `${url}${url.includes('?') ? '&' : '?'}r=${reload}`
  return <iframe className="preview-view" src={src} title="Forhåndsvisning" data-testid="preview-view" />
}
