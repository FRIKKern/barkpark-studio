import {useState} from 'react'
import {DialogBox} from './FocusScopes'
import {Close as CloseIcon} from './icons'
import {useT} from '../lib/i18n'

// A destructive action's confirmation (discard, delete, unpublish). Its own module so the
// releases page can use it without importing the document pane, which kept the pane and
// its fields in the chunk every page loads.
// `tone` primary: a change that is not destructive (a member's new role).
export function ConfirmDialog({title, body, action, run, onClose, tone = 'danger'}: {title: string; body: string; action: string; run: () => Promise<unknown>; onClose: () => void; tone?: 'danger' | 'primary'}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <div className="dialog-backdrop pane-confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog pane-confirm" aria-modal="true" aria-label={title} onClose={onClose}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          <p>{body}</p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="btn" autoFocus onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className={tone === 'primary' ? 'btn btn-primary' : 'btn danger'}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(undefined)
              try {
                await run()
                onClose()
              } catch (err) {
                setError((err as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {action}
          </button>
        </footer>
      </DialogBox>
    </div>
  )
}
