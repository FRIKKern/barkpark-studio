import {useEffect, type ReactNode} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate, useRouterState} from '@tanstack/react-router'
import {SignInForm} from './SignInForm'
import {editorIs, resumeSaving} from '../lib/edits'
import {useT} from '../lib/i18n'
import {meQuery} from '../lib/session'
import {onSessionChange} from '../lib/session-channel'
import {signOutHere} from '../lib/sign-out'

// What stays cached while signed out: who is signed in, and what the sign-in screen needs.
const KEEP = ['me', 'locale', 'scope']

/**
 * task-72b3bac89b1c6161: when the session ends, in this tab or another (Sign out there, an
 * expired cookie), the page shows the sign-in screen where it is, as Sanity's does, and keeps
 * nothing it read as that editor. Edits held here wait for the same editor (J48,
 * lib/edits.ts editorIs): signing in brings the page back at the same URL and sends them.
 * Signed in with no seat in this workspace (or one that doesn't exist): NoAccess instead.
 */
export function SessionGate({children}: {children: ReactNode}) {
  const t = useT()
  const qc = useQueryClient()
  const {data: me} = useQuery(meQuery)
  const atLogin = useRouterState({select: (s) => s.location.pathname === '/login'})
  const signedOut = !!me && me.signIn !== 'shared' && !me.email
  const email = me?.email ?? null
  useEffect(() => onSessionChange(() => void qc.invalidateQueries({queryKey: ['me']})), [qc])
  useEffect(() => void (signedOut && qc.removeQueries({predicate: (q) => !KEEP.includes(String(q.queryKey[0]))})), [qc, signedOut])
  useEffect(() => void (email && editorIs(email) && resumeSaving(qc)), [qc, email])
  if (me?.noSeat && !atLogin) return <NoAccess email={me.email!} />
  if (!signedOut || atLogin) return children
  return (
    <main className="login">
      <SignInForm heading={<h1>Barkpark Studio</h1>} autoFocus onSignedIn={() => qc.invalidateQueries({queryKey: ['me']})}>
        {(busy) => (
          <button className="publish" disabled={busy}>
            {busy ? t('Signing in…') : t('Sign in')}
          </button>
        )}
      </SignInForm>
    </main>
  )
}

/**
 * task-3982426459d4c4c1, Sanity's no-access screen: signed in, but with no seat in the
 * URL's workspace (or no such workspace). Nothing of it is read; the account is named, and
 * Sign out leads to the sign-in screen for this same page. Barkpark has no access requests
 * yet, so the card says whom to ask instead of offering one.
 */
function NoAccess({email}: {email: string}) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const here = useRouterState({select: (s) => s.location.href})
  return (
    <main className="login">
      <section className="card" role="alert">
        <h1>{t("You don't have access to this workspace")}</h1>
        <p>{t("Your account doesn't have access to this content. Ask a workspace admin to add you.")}</p>
        <p>
          {t('Signed in as')} <strong>{email}</strong>
        </p>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            await signOutHere(qc)
            await navigate({to: '/login', search: {redirect: here}})
          }}
        >
          {t('Wrong account? Sign out')}
        </button>
      </section>
    </main>
  )
}
