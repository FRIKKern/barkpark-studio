import {useEffect, useRef, useState} from 'react'
import {useQueries, useQuery, useQueryClient} from '@tanstack/react-query'
import {backlinksQuery, disconnectReferences, ensureBacklinks, previewTitle, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {reasonOf} from '../lib/edits'
import {DialogBox} from './FocusScopes'
import {UsedInList} from './DeleteDialog'
import {Close} from './icons'
import {useT} from '../lib/i18n'

/**
 * B07, after Barkpark's LiveView unpublish guard: before unpublishing, the documents that
 * refer to each one are listed (title, type / field), because their references will
 * point at nothing live. Unpublish anyway, or Cancel. A lookup still running, offline or
 * failed never reads as "nobody refers to it". One doc (the footer) or several (B03's
 * bulk bar). As LiveView, "Disconnect references and unpublish" first takes the
 * references out of those documents (Barkpark's disconnect, #22139).
 */
const BACKLINKS_BATCH = 100

export function UnpublishDialog({docs, run, onClose}: {docs: Doc[]; run: () => Promise<unknown>; onClose: () => void}) {
  const t = useT()
  const {data: schemas = []} = useQuery(schemasQuery)
  // Every document's backlinks in batches of 100 first (barkpark#23825), not one read per
  // document; a Barkpark without the batch read, or a failed one, lets each read alone.
  const qc = useQueryClient()
  const [primed, setPrimed] = useState(false)
  const ids = docs.map((d) => d._publishedId)
  useEffect(() => {
    let live = true
    void (async () => {
      for (let i = 0; i < ids.length; i += BACKLINKS_BATCH) if (!(await ensureBacklinks(qc, ids.slice(i, i + BACKLINKS_BATCH)).catch(() => false))) break
      if (live) setPrimed(true)
    })()
    return () => void (live = false)
  }, [ids.join(',')]) // the documents, by identity
  const lookups = useQueries({queries: docs.map((d) => ({...backlinksQuery(d._publishedId), refetchOnMount: 'always' as const, retry: false, enabled: primed}))})
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  // A background re-read (live frames) keeps what was found and the buttons as they are (J17).
  const checking = lookups.some((q) => q.isPending || (q.isFetching && !q.data) || q.fetchStatus === 'paused')
  const offline = lookups.some((q) => q.fetchStatus === 'paused')
  const failed = lookups.some((q) => q.isError && !q.isFetching)
  const used = docs.map((d, i) => ({doc: d, refs: lookups[i]?.data ?? []})).filter((u) => u.refs.length > 0)
  const many = docs.length > 1
  const title = (d: Doc) => previewTitle(d, schemaOf(schemas, d._type), t)
  const go = async (disconnect: boolean) => {
    cancel.current?.focus() // a disabled focused button would drop focus onto the page
    setBusy(true)
    setError(undefined)
    try {
      // The references go first: an unpublish that fails after leaves them out, as LiveView's.
      if (disconnect) for (const {doc} of used) await disconnectReferences({data: {id: doc._publishedId}})
      await run()
      onClose()
    } catch (err) {
      setError(reasonOf((err as Error).message) ?? (err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog delete-dialog" aria-modal="true" aria-labelledby="unpublish-title" onClose={onClose}>
        <header>
          <h2 id="unpublish-title">{many ? t('Unpublish {n} documents?', {n: docs.length}) : t('Unpublish document?')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          {checking && <p className="muted" role="status">{offline ? t("You're offline. Reconnect to check which documents refer to them.") : t('Looking for documents that refer to them…')}</p>}
          {failed && (
            <div role="alert">
              <p>{t('Could not check which documents refer to them. Retry before unpublishing.')}</p>
              <button type="button" className="btn" onClick={() => (cancel.current?.focus(), lookups.forEach((q) => q.isError && void q.refetch()))}>
                {t('Retry')}
              </button>
            </div>
          )}
          {!checking && !failed && (used.length === 0 || !many) && (
            // J04: Sanity's words for one document, asked first even when others refer to it.
            <p>
              {many ? (
                t('They will no longer be live. Each one stays as a draft you can publish again.')
              ) : (
                <WithStrong text={t('Are you sure you want to unpublish “{title}”?')} strong={title(docs[0]!)} />
              )}
            </p>
          )}
          {used.map(({doc, refs}) => (
            <section key={doc._publishedId} aria-label={t('Referring to {title}', {title: title(doc)})}>
              {/* Sanity's warning bar, its words for who refers, and what unpublishing does to them. */}
              <p className="warning" role="status">
                {refs.length === 1 ? t('1 document refers to “{title}”', {title: title(doc)}) : t('{n} documents refer to “{title}”', {title: title(doc), n: refs.length})}
              </p>
              <p>{t('You may not be able to unpublish “{title}” because the following documents refer to it:', {title: title(doc)})}</p>
              <UsedInList refs={refs} field />
              <p>{t('If you unpublish this document, documents that refer to it will no longer be able to access it.')}</p>
            </section>
          ))}
          {error && (
            <p className="field-error" role="alert">
              {t('Could not unpublish: {error}', {error: t(error)})}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="btn" ref={cancel} onClick={onClose}>
            {t('Cancel')}
          </button>
          {used.length > 0 && (
            <button type="button" className="btn" disabled={busy || checking || failed} onClick={() => void go(true)}>
              {t('Disconnect references and unpublish')}
            </button>
          )}
          <button type="button" className="btn danger" disabled={busy || checking || failed} onClick={() => void go(false)}>
            {used.length > 0 ? t('Unpublish anyway') : t('Unpublish now')}
          </button>
        </footer>
      </DialogBox>
    </div>
  )
}

/** A translated sentence with one `{title}` drawn bold (Sanity's confirm texts). */
export function WithStrong({text, strong}: {text: string; strong: string}) {
  const [before, after = ''] = text.split('{title}')
  return (
    <>
      {before}
      <strong>{strong}</strong>
      {after}
    </>
  )
}
