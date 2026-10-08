import {useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {devSignIn} from '../lib/session'
import {resumeSaving} from '../lib/edits'
import {DialogBox, PaneOverlay} from './FocusScopes'

// J48: the session is gone mid-edit. Sign in again right here — no navigation, so
// the edits typed meanwhile (held in this page) go out as you once you're back.
export function SignInAgain() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // Where the editor was typing when the session went: signed in again, they go back
  // there (the Sign in that opened the dialog leaves with the banner).
  const [editing] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)))
  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await devSignIn({data: {email}})
      await qc.invalidateQueries({queryKey: ['me']})
      resumeSaving(qc)
      setOpen(false)
      requestAnimationFrame(() => editing?.isConnected && editing !== document.body && editing.focus({preventScroll: true}))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Sign in
      </button>
      {open && (
        <PaneOverlay>
          <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <DialogBox className="dialog" aria-modal="true" aria-labelledby="sign-in-again-title" onClose={() => setOpen(false)}>
              <form
                className="dialog-body sign-in-again"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit()
                }}
              >
                <h2 id="sign-in-again-title">You've been logged out</h2>
                <p>Sign in again to save your edits. They are kept in this page until you do.</p>
                <label htmlFor="sign-in-again-email">Your email</label>
                <input id="sign-in-again-email" className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
                {error && <p className="field-error" role="alert">{error}</p>}
                <div className="dialog-actions">
                  <button type="button" className="btn" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <button className="publish" disabled={busy}>
                    {busy ? 'Signing in…' : 'Sign in'}
                  </button>
                </div>
              </form>
            </DialogBox>
          </div>
        </PaneOverlay>
      )}
    </>
  )
}
