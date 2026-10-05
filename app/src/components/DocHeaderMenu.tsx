import {useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {copy, fits, read, signature} from '../lib/clipboard'
import {edit} from '../lib/edits'
import type {Doc, Schema} from '../lib/data'
import {Ellipsis} from './icons'
import {toast} from './Toasts'

/**
 * The document pane header's "…" menu, after Sanity's: Copy document, Paste
 * document (J29). A paste fills every field whose name and schema type match the
 * copied document's and leaves the rest alone, so pasting a post into an author
 * moves only what fits.
 */
export function DocHeaderMenu({doc, schema, readOnly}: {doc: Doc; schema: Schema; readOnly: boolean}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn" aria-label="Show document actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <div className="popover menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && close()}>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            autoFocus
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
        </div>
      )}
    </div>
  )
}
