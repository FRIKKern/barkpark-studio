import {useEffect, useRef, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {useNavigate, useRouterState} from '@tanstack/react-router'
import {DialogBox} from './FocusScopes'
import {Close as CloseIcon, Transfer} from './icons'
import {useT} from '../lib/i18n'

// J68: Sanity's "Compare versions" from the document "…" menu: published on the left,
// read-only, the draft on the right with its changes marked in place and editable, the
// two scrolling together. In the URL as Sanity has it (?structure[diffView]=version&
// structure[previousDocument]=<type>,<id>&structure[nextDocument]=<type>,drafts.<id>), so a
// reload, a copied link or Sanity's own link reopens it.
// Barkpark has two versions of a document, so the two sides are fixed (Sanity's pickers
// choose among releases too).

const DIFF = 'structure[diffView]'
const PREV = 'structure[previousDocument]'
const NEXT = 'structure[nextDocument]'

/** Whether this document's comparison is open, and the URL changes that open and close it (and toggle Inline changes). */
export function useCompareVersions(type: string, id: string) {
  const navigate = useNavigate()
  const href = useRouterState({select: (s) => s.location.href})
  const [path, query = ''] = href.split(/\?(.*)/s)
  const q = new URLSearchParams(query)
  const isOpen = q.get(DIFF) === 'version' && q.get(PREV) === `${type},${id}` && q.get(NEXT) === `${type},drafts.${id}`
  const go = (change: (q: URLSearchParams) => void) => {
    const next = new URLSearchParams(query)
    change(next)
    const qs = next.toString()
    void navigate({href: qs ? `${path}?${qs}` : path!})
  }
  return {
    isOpen,
    open: () => go((n) => (n.set(DIFF, 'version'), n.set(PREV, `${type},${id}`), n.set(NEXT, `${type},drafts.${id}`))),
    close: () => go((n) => [DIFF, PREV, NEXT].forEach((k) => n.delete(k))),
    toggleInline: () => go((n) => (n.get('displayInlineChanges') === 'true' ? n.delete('displayInlineChanges') : n.set('displayInlineChanges', 'true'))),
  }
}

export function CompareVersions({published, draft, onClose}: {published: ReactNode; draft: ReactNode; onClose: () => void}) {
  const t = useT()
  const left = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)
  // Drawn in <body>, so in the browser only (a reload on its URL renders the pane first).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Sanity's scroll mirror: either side scrolls the other to the same place.
  useEffect(() => {
    const a = left.current
    const b = right.current
    if (!a || !b) return
    let from: HTMLElement | null = null
    const follow = (src: HTMLElement, dst: HTMLElement) => () => {
      if (from && from !== src) return
      from = src
      dst.scrollTop = src.scrollTop
      requestAnimationFrame(() => (from = null))
    }
    const onA = follow(a, b)
    const onB = follow(b, a)
    a.addEventListener('scroll', onA)
    b.addEventListener('scroll', onB)
    return () => (a.removeEventListener('scroll', onA), b.removeEventListener('scroll', onB))
  }, [mounted])
  if (!mounted) return null
  return createPortal(
    <div className="dialog-backdrop compare-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog compare" aria-modal="true" aria-label={t('Compare versions')} onClose={onClose} data-testid="compare-versions">
        <header>
          <h2>{t('Compare versions')}</h2>
          <span className="compare-sides">
            <span className="chip" data-version="published">
              <span className="dot published" />
              {t('Published')}
            </span>
            <Transfer />
            <span className="chip" data-version="draft">
              <span className="dot draft" />
              {t('Draft')}
            </span>
          </span>
          <button type="button" className="icon-btn" aria-label={t('Close')} autoFocus onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="compare-body">
          <div ref={left} className="compare-side doc-form" data-side="published" aria-label={t('Published')} role="region">
            {published}
          </div>
          <div ref={right} className="compare-side doc-form" data-side="draft" aria-label={t('Draft')} role="region">
            {draft}
          </div>
        </div>
      </DialogBox>
    </div>,
    document.body,
  )
}
