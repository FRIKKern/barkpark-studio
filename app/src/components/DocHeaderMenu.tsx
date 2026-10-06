import {useState} from 'react'
import {DialogBox, MenuPopover} from './FocusScopes'
import {useQueryClient} from '@tanstack/react-query'
import {copy, fits, read, signature} from '../lib/clipboard'
import {edit} from '../lib/edits'
import type {Doc, Schema} from '../lib/data'
import {Ellipsis, Share} from './icons'
import {toast} from './Toasts'

/**
 * The document pane header's "…" menu, after Sanity's: Copy document, Paste
 * document (J29). A paste fills every field whose name and schema type match the
 * copied document's and leaves the rest alone, so pasting a post into an author
 * moves only what fits.
 */
export function DocHeaderMenu({doc, schema, readOnly, onInspect, onHistory}: {doc: Doc; schema: Schema; readOnly: boolean; onInspect: () => void; onHistory: () => void}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn" aria-label="Show document actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <MenuPopover onClose={close}>
          <button type="button" role="menuitem" className="menu-item" autoFocus onClick={() => (close(), onHistory())}>
            History
          </button>
          <button type="button" role="menuitem" className="menu-item" aria-keyshortcuts="Control+Alt+I" onClick={() => (close(), onInspect())}>
            Inspect
            <kbd>Ctrl Alt I</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              copy({kind: 'document', docType: schema.name, fields: schema.fields.map((f) => ({name: f.name, sig: signature(f), value: doc[f.name]}))})
              close()
            }}
          >
            Copy document
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={readOnly}
            onClick={() => {
              close()
              const clip = read()
              if (clip?.kind !== 'document') return toast({tone: 'critical', title: 'Nothing to paste', description: 'Copy a document first'})
              const matching = schema.fields.flatMap((f) => {
                const from = clip.fields.find((c) => c.name === f.name)
                return from && from.value !== undefined && fits(from.sig, from.value, f) ? [[f.name, from.value] as const] : []
              })
              if (!matching.length) return toast({tone: 'critical', title: 'Invalid clipboard item', description: 'Source and target schema types are not compatible'})
              for (const [name, value] of matching) edit(qc, doc, name, value)
            }}
          >
            Paste document
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
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const put = (text: string, what: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast({title: `${what} copied to clipboard`}))
      .catch(() => toast({tone: 'critical', title: `Could not copy ${what.toLowerCase()}`}))
    close()
  }
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn" aria-label="Share document" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Share />
      </button>
      {open && (
        <MenuPopover onClose={close}>
          <button type="button" role="menuitem" className="menu-item" autoFocus onClick={() => put(`${location.origin}/structure/${doc._type};${doc._publishedId}`, 'Document URL')}>
            Copy document URL
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => put(doc._id, 'Document ID')}>
            Copy document ID
          </button>
        </MenuPopover>
      )}
    </div>
  )
}
