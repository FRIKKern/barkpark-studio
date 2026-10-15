import {useEffect, type ReactNode} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useRouterState} from '@tanstack/react-router'
import {SignInForm} from './SignInForm'
import {editorIs, resumeSaving} from '../lib/edits'
import {useT} from '../lib/i18n'
import {meQuery} from '../lib/session'
import {onSessionChange} from '../lib/session-channel'

// What stays cached while signed out: who is signed in, and what the sign-in screen needs.
const KEEP = ['me', 'locale', 'scope']

/**
 * task-72b3bac89b1c6161: when the session ends, in this tab or another (Sign out there, an
 * expired cookie), the page shows the sign-in screen where it is, as Sanity's does, and keeps
 * nothing it read as that editor. Edits held here wait for the same editor (J48,
 * lib/edits.ts editorIs): signing in brings the page back at the same URL and sends them.
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
