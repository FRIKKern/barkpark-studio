import {useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {SignInForm} from './SignInForm'
import {resumeSaving} from '../lib/edits'
import {DialogBox, PaneOverlay} from './FocusScopes'
import {useT} from '../lib/i18n'

// J48: the session is gone mid-edit. Sign in again right here — no navigation, so
// the edits typed meanwhile (held in this page) go out as you once you're back.
export function SignInAgain() {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  // Where the editor was typing when the session went: signed in again, they go back
  // there (the Sign in that opened the dialog leaves with the banner).
  const [editing] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)))
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {t('Sign in')}
      </button>
      {open && (
        <PaneOverlay>
          <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <DialogBox className="dialog" aria-modal="true" aria-labelledby="sign-in-again-title" onClose={() => setOpen(false)}>
              <SignInForm
                idPrefix="sign-in-again"
                className="dialog-body sign-in-again"
                autoFocus
                heading={
                  <>
                    <h2 id="sign-in-again-title">{t("You've been logged out")}</h2>
                    <p>{t('Sign in again to save your edits. They are kept in this page until you do.')}</p>
                  </>
                }
                onSignedIn={async () => {
                  await qc.invalidateQueries({queryKey: ['me']})
                  resumeSaving(qc)
                  setOpen(false)
                  requestAnimationFrame(() => editing?.isConnected && editing !== document.body && editing.focus({preventScroll: true}))
                }}
              >
                {(busy) => (
                  <div className="dialog-actions">
                    <button type="button" className="btn" onClick={() => setOpen(false)}>
                      {t('Cancel')}
                    </button>
                    <button className="publish" disabled={busy}>
                      {busy ? t('Signing in…') : t('Sign in')}
                    </button>
                  </div>
                )}
              </SignInForm>
            </DialogBox>
          </div>
        </PaneOverlay>
      )}
    </>
  )
}
