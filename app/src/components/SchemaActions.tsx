import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {docActionsQuery, runDocAction, type ActionPreview, type DocAction} from '../lib/doc-actions'
import type {Doc} from '../lib/data'
import {useT} from '../lib/i18n'
import {DialogBox} from './FocusScopes'
import {toast} from './Toasts'

/**
 * B10: the schema's own document actions in the footer's "…" menu, after the
 * built-in ones (LiveView puts them last in its editor header). A `modal` one opens
 * Barkpark's two-step confirm: Confirm runs a dry-run and shows its preview, then
 * "Confirm for real" runs it.
 */
export function useSchemaActions(doc: Doc, closeMenu: () => void) {
  const slug = typeof doc.slug === 'string' ? doc.slug : (doc.slug as {current?: string} | undefined)?.current
  const {data: actions = []} = useQuery(docActionsQuery(doc._type, doc._publishedId, slug))
  const [open, setOpen] = useState<DocAction | null>(null)
  const items = actions.map((a) =>
    a.kind === 'link' ? (
      <a key={a.name} role="menuitem" className="menu-item" href={a.href} target="_blank" rel="noopener" onClick={closeMenu}>
        {a.label}
      </a>
    ) : (
      <button key={a.name} type="button" role="menuitem" className="menu-item" onClick={() => (closeMenu(), setOpen(a))}>
        {a.label}
      </button>
    ),
  )
  const dialog = open && <ActionDialog action={open} doc={doc} onClose={() => setOpen(null)} />
  return {items, dialog}
}

function ActionDialog({action, doc, onClose}: {action: DocAction; doc: Doc; onClose: () => void}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ActionPreview | null>(null)
  const title = action.modal?.title ?? action.label
  const run = async (mode: 'dryrun' | 'real') => {
    setBusy(true)
    try {
      const out = await runDocAction({data: {type: doc._type, id: doc._publishedId, name: action.name, mode}})
      if (mode === 'dryrun') return setPreview('preview' in out ? out.preview : {kind: 'error', message: 'error' in out ? out.error : t('No preview')})
      onClose()
      if ('error' in out) toast({tone: 'critical', title: t('{action} failed', {action: action.label}), description: out.error})
      else toast({tone: 'positive', title: t('{action} started', {action: action.label})})
    } catch (e) {
      if (mode === 'dryrun') setPreview({kind: 'error', message: (e as Error).message})
      else (onClose(), toast({tone: 'critical', title: t('{action} failed', {action: action.label}), description: (e as Error).message}))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog schema-action" aria-modal="true" aria-label={title} onClose={onClose}>
        <header>
          <h2>{title}</h2>
        </header>
        <div className="dialog-body">
          {action.modal?.body && <p>{action.modal.body}</p>}
          {preview && <PreviewBox preview={preview} />}
        </div>
        <footer aria-busy={busy}>
          <button type="button" className="btn" autoFocus onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => run('dryrun')}>
            {preview ? t('Run dry-run again') : t('Confirm')}
          </button>
          {preview && preview.kind !== 'error' && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run('real')}>
              {t('Confirm for real')}
            </button>
          )}
        </footer>
      </DialogBox>
    </div>
  )
}

/** The dry-run's answer: rendered XML (OnixEdit), a refusal, or the raw result. */
function PreviewBox({preview}: {preview: ActionPreview}) {
  const t = useT()
  if (preview.kind === 'error')
    return (
      <p className="field-error" role="alert">
        {t('Dry-run failed: {message}', {message: String(preview.message)})}
      </p>
    )
  return (
    <figure className="action-preview" aria-label={t('Dry-run preview')}>
      <pre>{preview.kind === 'xml' && typeof preview.xml === 'string' ? preview.xml : JSON.stringify(preview, null, 2)}</pre>
    </figure>
  )
}
