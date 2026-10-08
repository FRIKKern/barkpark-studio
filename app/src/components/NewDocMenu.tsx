import {useId, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {isSingleton, schemasQuery} from '../lib/data'
import {createDoc, draftNew} from '../lib/edits'
import {editorMode} from '../lib/editor-mode'
import {focusFirstField} from '../lib/focus'
import {useFocusScope} from '../lib/focus-scope'
import {useCanWrite} from '../lib/session'
import {Add, Search} from './icons'
import {toast} from './Toasts'

// J37, Sanity's navbar "+" ("Create new document"): a filterable list of the
// types, A–Z; picking one opens a new document of it as the type's list + the
// doc, created on its first edit like the list's own "+" (J18). Singletons are
// never offered (B13).
export function NewDocMenu() {
  const {data: schemas = []} = useQuery(schemasQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const {canWrite, createReason} = useCanWrite()
  const [open, setOpen] = useState(false)
  return (
    <div className="menu-wrap new-doc">
      <button type="button" className="icon-btn" aria-label="Create new document" title={canWrite ? 'New document…' : createReason} disabled={!canWrite} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Add />
      </button>
      {open && (
        <TypePicker
          types={schemas.filter((s) => !isSingleton(schemas, s.name)).sort((a, b) => a.title.localeCompare(b.title))}
          onClose={() => setOpen(false)}
          onPick={(type) => {
            setOpen(false)
            const schema = schemas.find((s) => s.name === type)
            const id = crypto.randomUUID()
            if (editorMode(type, schema) !== 'none')
              void createDoc(qc, type, id, {}).catch((err) => toast({tone: 'critical', title: 'Could not create the document', description: (err as Error).message}))
            else draftNew(qc, type, id, schema?.initialValues ?? {})
            void navigate({href: `/structure/${type};${id}`})
            focusFirstField(id)
          }}
        />
      )}
    </div>
  )
}

function TypePicker({types, onPick, onClose}: {types: {name: string; title: string}[]; onPick: (type: string) => void; onClose: () => void}) {
  const scope = useFocusScope<HTMLDivElement>({onDismiss: onClose})
  const [find, setFind] = useState('')
  const [active, setActive] = useState(0)
  const id = useId()
  const shown = types.filter((t) => t.title.toLowerCase().includes(find.trim().toLowerCase()))
  const at = Math.min(active, shown.length - 1)
  return (
    <div ref={scope} className="popover new-doc-popover" onBlur={(e) => !e.currentTarget.parentElement?.contains(e.relatedTarget) && onClose()}>
      <div className="command-find">
        <Search />
        <input
          autoFocus
          role="combobox"
          aria-label="Search document types"
          placeholder="Search document types"
          aria-expanded={shown.length > 0}
          aria-controls={shown.length ? id : undefined}
          aria-activedescendant={shown.length ? `${id}-${at}` : undefined}
          value={find}
          onChange={(e) => (setFind(e.target.value), setActive(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive(Math.min(at + 1, shown.length - 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive(Math.max(at - 1, 0)))
            else if (e.key === 'Enter' && shown[at]) (e.preventDefault(), onPick(shown[at]!.name))
          }}
        />
      </div>
      {shown.length > 0 ? (
        <div role="listbox" id={id} aria-label="New document" className="command-list">
          {shown.map((t, i) => (
            <div key={t.name} id={`${id}-${i}`} role="option" aria-selected={i === at} className="command-item" onMouseEnter={() => setActive(i)} onMouseDown={(e) => (e.preventDefault(), onPick(t.name))}>
              {t.title}
            </div>
          ))}
        </div>
      ) : (
        <p className="command-empty">
          No results for <strong>{find}</strong>
        </p>
      )}
    </div>
  )
}
