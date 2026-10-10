import {useState, type ReactNode} from 'react'
import {useQuery} from '@tanstack/react-query'
import {devSignIn, meQuery, signInWithAccount} from '../lib/session'
import {useT} from '../lib/i18n'

/**
 * The sign-in fields (server/auth.ts says which way in): a Barkpark account's email and
 * password, then its six-digit code when Barkpark asks for one (J67); or, with dev
 * sign-in, an email only. `onSignedIn` runs once the session holds. Used by /login and
 * by J48's sign-in-again dialog, so both ask the same way.
 */
export function SignInForm({idPrefix, className, heading, autoFocus, onSignedIn, children}: {idPrefix?: string; className?: string; heading: ReactNode; autoFocus?: boolean; onSignedIn: () => Promise<void> | void; children: (busy: boolean) => ReactNode}) {
  const t = useT()
  const {data: me} = useQuery(meQuery)
  const dev = me?.signIn === 'dev'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [askCode, setAskCode] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const id = (name: string) => (idPrefix ? `${idPrefix}-${name}` : name)
  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      if (dev) await devSignIn({data: {email}})
      else {
        const r = await signInWithAccount({data: {email, password, code: askCode ? code : undefined}})
        if (!r.ok) {
          // Barkpark asks for the account's second factor: ask for it, keep what was typed.
          if (r.code === 'mfa_required' && !askCode) return setAskCode(true)
          setPassword('')
          return setError(r.code === 'invalid_credentials' ? t('The email or password is incorrect.') : r.code === 'mfa_required' ? t('That code is not right. Try the current one.') : r.message)
        }
      }
      setPassword('')
      await onSignedIn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {heading}
      {dev && <p className="dev-badge">{t('Dev sign-in — no password. Never enabled in a production build.')}</p>}
      <label htmlFor={id('email')}>{t('Your email')}</label>
      <input id={id('email')} className="input" type="email" autoComplete="username" list={dev ? 'editors' : undefined} autoFocus={autoFocus} required value={email} onChange={(e) => setEmail(e.target.value)} />
      {dev && (
        <datalist id="editors">
          {['a', 'b', 'c', 'd'].map((x) => (
            <option key={x} value={`studio-editor-${x}@example.com`} />
          ))}
        </datalist>
      )}
      {!dev && (
        <>
          <label htmlFor={id('password')}>{t('Password')}</label>
          <input id={id('password')} className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </>
      )}
      {askCode && (
        <>
          <label htmlFor={id('code')}>{t('Code from your authenticator app')}</label>
          <input id={id('code')} className="input" inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} />
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {children(busy)}
    </form>
  )
}
