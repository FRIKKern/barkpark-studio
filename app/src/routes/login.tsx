import {useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {createFileRoute, useNavigate} from '@tanstack/react-router'
import {devSignIn, meQuery} from '../lib/session'

// Dev-only sign-in (server/auth.ts): names who you are; no password yet.
// The seated test editors are studio-editor-{a..d}@example.com.
export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>) => ({redirect: typeof s.redirect === 'string' ? s.redirect : '/structure'}),
  component: Login,
})

function Login() {
  const {redirect} = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  return (
    <main className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(undefined)
          try {
            await devSignIn({data: {email}})
            await qc.invalidateQueries({queryKey: ['me']})
            qc.removeQueries({predicate: (q) => q.queryKey[0] !== 'me'}) // re-read as this editor
            await navigate({href: redirect})
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <h1>Barkpark Studio</h1>
        <p className="dev-badge">Dev sign-in — no password. Never enabled in a production build.</p>
        <label htmlFor="email">Your email</label>
        <input id="email" className="input" type="email" list="editors" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        <datalist id="editors">
          {['a', 'b', 'c', 'd'].map((x) => (
            <option key={x} value={`studio-editor-${x}@example.com`} />
          ))}
        </datalist>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button className="publish" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
