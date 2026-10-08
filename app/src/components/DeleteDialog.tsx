import {useEffect, useRef, useState} from 'react'
import {DialogBox} from './FocusScopes'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {backlinksQuery, previewTitle, schemaOf, schemasQuery, type Backlink, type Doc} from '../lib/data'
import {deleteDoc} from '../lib/edits'
import {Close, DocumentIcon} from './icons'
import {DocPreview} from './Preview'
import {useScopedHref, usePaneNavigate} from './PaneLink'
import {useT} from '../lib/i18n'

/**
 * Sanity's delete dialog (J17): the doc, and when other documents refer to it a
 * warning plus the list of them ("used in"). The server refuses deletion while
 * references remain; a failed lookup must never look like an empty list.
 */
export function DeleteDialog({doc, closeHref, onClose}: {doc: Doc; closeHref: string; onClose: () => void}) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = usePaneNavigate()
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: refs, isPending, isFetching, isError, fetchStatus, refetch} = useQuery({
    ...backlinksQuery(doc._publishedId), refetchOnMount: 'always', retry: false,
  })
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  const title = previewTitle(doc, schemaOf(schemas, doc._type))
  const used = refs?.length ?? 0

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog delete-dialog" aria-modal="true" aria-labelledby="delete-title" onClose={onClose}>
        <header>
          <h2 id="delete-title">{t('Delete document?')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          <p>{t('Are you sure you want to delete this document?')}</p>
          <div className="ref-box">
            <DocPreview doc={doc} selected={false} />
          </div>
          {(isPending || isFetching || fetchStatus === 'paused') && <p className="muted" role="status">
            {fetchStatus === 'paused' ? t("You're offline. Reconnect to check where this document is used.") : t('Looking for documents that refer to it…')}
          </p>}
          {isError && !isFetching && (
            <div role="alert">
              <p>{t('Could not check where this document is used. Retry before deleting.')}</p>
              <button type="button" className="btn" onClick={() => { cancel.current?.focus(); void refetch() }}>{t('Retry')}</button>
            </div>
          )}
          {used > 0 && (
            <section aria-label={t('Used in')}>
              <p className="warning" role="status">
                {used === 1 ? t('1 document refers to “{title}”', {title}) : t('{n} documents refer to “{title}”', {n: used, title})}
              </p>
              <p>{t('You may not be able to delete “{title}” because the following documents refer to it:', {title})}</p>
              <UsedInList refs={refs!} />
            </section>
          )}
          {error && (
            <p className="field-error" role="alert">
              {t('Could not delete: {error}', {error: t(error)})}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="btn" ref={cancel} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy || isPending || isFetching || isError || fetchStatus === 'paused'}
            onClick={async () => {
              // Disabling the focused Delete button would drop focus onto the page.
              cancel.current?.focus()
              setBusy(true)
              setError(undefined)
              try {
                await deleteDoc(qc, doc)
                onClose()
                void navigate({href: closeHref})
              } catch (err) {
                const message = (err as Error).message
                setError(message.includes('document_referenced')
                  ? 'This document is still referenced. Remove those references before deleting it.'
                  : message)
                void refetch()
              } finally {
                setBusy(false)
              }
            }}
          >
            {used > 0 ? t('Delete anyway') : t('Delete now')}
          </button>
        </footer>
      </DialogBox>
    </div>
  )
}

/** The documents that refer to one ("used in"), each opening in a new tab; `field` adds the field that refers (B07). */
export function UsedInList({refs, field}: {refs: Backlink[]; field?: boolean}) {
  const t = useT()
  const {data: schemas = []} = useQuery(schemasQuery)
  const scoped = useScopedHref()
  return (
    <ul className="used-in">
      {refs.map((r) => (
        <li key={`${r.type}:${r.from_doc_id}:${r.via_field}`}>
          <a className="preview" href={scoped(`/structure/${r.type};${encodeURIComponent(r.from_doc_id)}`)} target="_blank" rel="noreferrer" title={t('Open in a new tab ({type})', {type: schemaOf(schemas, r.type)?.title ?? r.type})}>
            <span className="media">
              <DocumentIcon />
            </span>
            <span className="text">
              <div className="t">{r.title}</div>
              {field && <div className="s">{`${schemaOf(schemas, r.type)?.title ?? r.type} / ${r.via_field}`}</div>}
            </span>
            <span className="dot" />
          </a>
        </li>
      ))}
    </ul>
  )
}
