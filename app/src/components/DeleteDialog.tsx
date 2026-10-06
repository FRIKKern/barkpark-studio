import {useEffect, useRef, useState} from 'react'
import {DialogBox} from './FocusScopes'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {backlinksQuery, previewTitle, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {deleteDoc} from '../lib/edits'
import {Close, DocumentIcon} from './icons'
import {DocPreview} from './Preview'

/**
 * Sanity's delete dialog (J17): the doc, and when other documents refer to it a
 * warning plus the list of them ("used in"). Refusing the delete is the server's
 * job (task-c8c22ee8076535fe); until it does, "Delete anyway" deletes, as in Sanity.
 */
export function DeleteDialog({doc, closeHref, onClose}: {doc: Doc; closeHref: string; onClose: () => void}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: refs, isPending} = useQuery(backlinksQuery(doc._publishedId))
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  const title = previewTitle(doc, schemaOf(schemas, doc._type))
  const used = refs?.length ?? 0

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog" aria-modal="true" aria-labelledby="delete-title" onClose={onClose}>
        <header>
          <h2 id="delete-title">Delete document?</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          <p>Are you sure you want to delete this document?</p>
          <div className="ref-box">
            <DocPreview doc={doc} selected={false} />
          </div>
          {isPending && <p className="muted">Looking for documents that refer to it…</p>}
          {used > 0 && (
            <section aria-label="Used in">
              <p className="warning" role="status">
                {used} {used === 1 ? 'document refers' : 'documents refer'} to “{title}”
              </p>
              <p>You may not be able to delete “{title}” because the following documents refer to it:</p>
              <ul className="used-in">
                {refs!.map((r) => (
                  <li key={`${r.type}:${r.from_doc_id}`}>
                    <a className="preview" href={`/structure/${r.type};${encodeURIComponent(r.from_doc_id)}`} target="_blank" rel="noreferrer" title={`Open in a new tab (${schemaOf(schemas, r.type)?.title ?? r.type})`}>
                      <span className="media">
                        <DocumentIcon />
                      </span>
                      <span className="text">
                        <div className="t">{r.title}</div>
                      </span>
                      <span className="dot" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {error && (
            <p className="field-error" role="alert">
              Could not delete: {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="btn" ref={cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy || isPending}
            onClick={async () => {
              setBusy(true)
              setError(undefined)
              try {
                await deleteDoc(qc, doc)
                onClose()
                void navigate({href: closeHref})
              } catch (err) {
                setError((err as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {used > 0 ? 'Delete anyway' : 'Delete now'}
          </button>
        </footer>
      </DialogBox>
    </div>
  )
}
