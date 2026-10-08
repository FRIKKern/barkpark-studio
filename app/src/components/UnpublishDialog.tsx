import {useEffect, useRef, useState} from 'react'
import {useQueries, useQuery} from '@tanstack/react-query'
import {backlinksQuery, previewTitle, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {reasonOf} from '../lib/edits'
import {DialogBox} from './FocusScopes'
import {UsedInList} from './DeleteDialog'
import {Close} from './icons'

/**
 * B07, after Barkpark's LiveView unpublish guard: before unpublishing, the documents that
 * refer to each one are listed (title, type / field), because their references will
 * point at nothing live. Unpublish anyway, or Cancel. A lookup still running, offline or
 * failed never reads as "nobody refers to it". One doc (the footer) or several (B03's
 * bulk bar). (LiveView also offers "Disconnect references and unpublish"; Barkpark has
 * no HTTP route for that yet: task-0bc05ce5cdefd8dc.)
 */
export function UnpublishDialog({docs, run, onClose}: {docs: Doc[]; run: () => Promise<unknown>; onClose: () => void}) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const lookups = useQueries({queries: docs.map((d) => ({...backlinksQuery(d._publishedId), refetchOnMount: 'always' as const, retry: false}))})
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  const checking = lookups.some((q) => q.isPending || q.isFetching || q.fetchStatus === 'paused')
  const offline = lookups.some((q) => q.fetchStatus === 'paused')
  const failed = lookups.some((q) => q.isError && !q.isFetching)
  const used = docs.map((d, i) => ({doc: d, refs: lookups[i]?.data ?? []})).filter((u) => u.refs.length > 0)
  const many = docs.length > 1
  const title = (d: Doc) => previewTitle(d, schemaOf(schemas, d._type))
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog delete-dialog" aria-modal="true" aria-labelledby="unpublish-title" onClose={onClose}>
        <header>
          <h2 id="unpublish-title">{many ? `Unpublish ${docs.length} documents?` : 'Unpublish document?'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          {checking && <p className="muted" role="status">{offline ? "You're offline. Reconnect to check which documents refer to them." : 'Looking for documents that refer to them…'}</p>}
          {failed && (
            <div role="alert">
              <p>Could not check which documents refer to them. Retry before unpublishing.</p>
              <button type="button" className="btn" onClick={() => (cancel.current?.focus(), lookups.forEach((q) => q.isError && void q.refetch()))}>
                Retry
              </button>
            </div>
          )}
          {!checking && !failed && used.length === 0 && (
            <p>{many ? 'They will no longer be live. Each one stays as a draft you can publish again.' : 'It will no longer be live. Its content stays as a draft you can publish again.'}</p>
          )}
          {used.map(({doc, refs}) => (
            <section key={doc._publishedId} aria-label={`Referring to ${title(doc)}`}>
              <p className="warning" role="status">
                “{title(doc)}” is referenced by {refs.length} {refs.length === 1 ? 'document' : 'documents'}. Unpublishing it will leave those references pointing at nothing live:
              </p>
              <UsedInList refs={refs} field />
            </section>
          ))}
          {error && (
            <p className="field-error" role="alert">
              Could not unpublish: {error}
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
            disabled={busy || checking || failed}
            onClick={async () => {
              cancel.current?.focus() // a disabled focused button would drop focus onto the page
              setBusy(true)
              setError(undefined)
              try {
                await run()
                onClose()
              } catch (err) {
                setError(reasonOf((err as Error).message) ?? (err as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {used.length > 0 ? 'Unpublish anyway' : 'Unpublish now'}
          </button>
        </footer>
      </DialogBox>
    </div>
  )
}
