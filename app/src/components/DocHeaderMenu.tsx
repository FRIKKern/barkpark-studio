import {useEffect, useState} from 'react'
import {MenuPopover} from './FocusScopes'
import {useQueryClient} from '@tanstack/react-query'
import {copy, fits, read, signature} from '../lib/clipboard'
import {edit} from '../lib/edits'
import type {Doc, Schema} from '../lib/data'
import {Braces, ClipboardIcon, Clock, Copy, EarthGlobe, Ellipsis, Share, LinkIcon} from './icons'
import studio from '../studio.config'
import {toast} from './Toasts'
import {useScopedHref} from './PaneLink'
import {t as tt, useT} from '../lib/i18n'

/** Sanity names the Alt key "Option" on a Mac in its shortcut chips; known only in the browser. */
export function useAltName() {
  const [alt, setAlt] = useState('Alt')
  useEffect(() => setAlt(/Mac|iPhone|iPad/.test(navigator.platform) ? 'Option' : 'Alt'), [])
  return alt
}

/** A shortcut chip, Sanity's: each key in its own box ("Ctrl" "Option" "D"). */
export function Keys({keys}: {keys: string[]}) {
  return (
    <span className="keys" aria-hidden="true">
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  )
}

/** J65: "Open preview" (menu and Ctrl+Alt+O) opens the studio config's URL for the document in a new tab. */
export function openPreview(url: string) {
  window.open(url, '_blank', 'noopener')
}

/** Copy the document's URL or ID, confirmed with Sanity's toast. */
function useCopyRef(doc: Doc, after: () => void) {
  const scoped = useScopedHref()
  // Runs on a click (browser only): the global translate.
  const put = (text: string, done: string, failed: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast({title: tt(done)}))
      .catch(() => toast({tone: 'critical', title: tt(failed)}))
    after()
  }
  return {
    url: () => put(`${location.origin}${scoped(`/structure/${doc._type};${doc._publishedId}`)}`, 'Document URL copied to clipboard', 'Could not copy document url'),
    id: () => put(doc._id, 'Document ID copied to clipboard', 'Could not copy document id'),
  }
}

/**
 * The document pane header's "…" menu, after Sanity's:
 * History, Incoming references (J17), Inspect, Open preview (J65), Copy document, Paste
 * document (J29). A paste fills every field whose name and schema type match the
 * copied document's and leaves the rest alone, so pasting a post into an author
 * moves only what fits.
 */
export function DocHeaderMenu({doc, schema, readOnly, onInspect, onHistory, onIncoming}: {doc: Doc; schema: Schema; readOnly: boolean; onInspect: () => void; onHistory: () => void; onIncoming: () => void}) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const alt = useAltName()
  const previewUrl = studio.document?.productionUrl?.(doc)
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn" aria-label={t('Show document actions')} data-tip={t('Show more')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <MenuPopover onClose={close}>
          <button type="button" role="menuitem" className="menu-item" autoFocus onClick={() => (close(), onHistory())}>
            <span className="menu-icon-text">
              <Clock /> {t('History')}
            </span>
          </button>
          {/* J17 widen: Sanity's "Incoming references", next after History as there. */}
          <button type="button" role="menuitem" className="menu-item" onClick={() => (close(), onIncoming())}>
            <span className="menu-icon-text">
              <LinkIcon /> {t('Incoming references')}
            </span>
          </button>
          <button type="button" role="menuitem" className="menu-item" aria-keyshortcuts="Control+Alt+I" onClick={() => (close(), onInspect())}>
            <span className="menu-icon-text">
              <Braces /> {t('Inspect')}
            </span>
            <Keys keys={['Ctrl', alt, 'I']} />
          </button>
          <hr />
          {/* J65: the studio config's preview URL, opened in a new tab. */}
          {previewUrl && (
            <>
              <button type="button" role="menuitem" className="menu-item" aria-keyshortcuts="Control+Alt+O" onClick={() => (close(), openPreview(previewUrl))}>
                <span className="menu-icon-text">
                  <EarthGlobe /> {t('Open preview')}
                </span>
                <Keys keys={['Ctrl', alt, 'O']} />
              </button>
              <hr />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              copy({kind: 'document', docType: schema.name, fields: schema.fields.map((f) => ({name: f.name, sig: signature(f), value: doc[f.name]}))})
              close()
            }}
          >
            <span className="menu-icon-text">
              <Copy /> {t('Copy document')}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={readOnly}
            onClick={() => {
              close()
              const clip = read()
              if (clip?.kind !== 'document') return toast({tone: 'critical', title: tt('Nothing to paste'), description: tt('Copy a document first')})
              const matching = schema.fields.flatMap((f) => {
                const from = clip.fields.find((c) => c.name === f.name)
                return from && from.value !== undefined && fits(from.sig, from.value, f) ? [[f.name, from.value] as const] : []
              })
              if (!matching.length) return toast({tone: 'critical', title: tt('Invalid clipboard item'), description: tt('Source and target schema types are not compatible')})
              for (const [name, value] of matching) edit(qc, doc, name, value)
            }}
          >
            <span className="menu-icon-text">
              <ClipboardIcon /> {t('Paste document')}
            </span>
          </button>
        </MenuPopover>
      )}
    </div>
  )
}

/**
 * The share button that heads Sanity's document pane (J28): Copy document URL,
 * Copy document ID, each confirmed with Sanity's toast. The URL is this studio's
 * deep link to the document.
 */
export function DocShareMenu({doc}: {doc: Doc}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const copyRef = useCopyRef(doc, close)
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn" aria-label={t('Share document')} data-tip={t('Share')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Share />
      </button>
      {open && (
        <MenuPopover onClose={close}>
          <button type="button" role="menuitem" className="menu-item" autoFocus onClick={copyRef.url}>
            {t('Copy document URL')}
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={copyRef.id}>
            {t('Copy document ID')}
          </button>
        </MenuPopover>
      )}
    </div>
  )
}
