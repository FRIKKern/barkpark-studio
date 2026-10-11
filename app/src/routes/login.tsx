import {useQueryClient} from '@tanstack/react-query'
import {createFileRoute, useNavigate} from '@tanstack/react-router'
import {SignInForm} from '../components/SignInForm'
import {useHydratedMark} from '../lib/hydrated'
import {useT} from '../lib/i18n'

// The sign-in screen (server/auth.ts): a Barkpark account (J67), or dev sign-in's email
// only. The seated dev test editors are studio-editor-{a..d}@example.com.
export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>) => ({redirect: typeof s.redirect === 'string' ? s.redirect : '/structure'}),
  component: Login,
})

function Login() {
  useHydratedMark()
  const t = useT()
  const {redirect} = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  return (
    <main className="login">
      <SignInForm
        heading={<h1>Barkpark Studio</h1>}
        autoFocus
        onSignedIn={async () => {
          await qc.invalidateQueries({queryKey: ['me']})
          qc.removeQueries({predicate: (q) => q.queryKey[0] !== 'me'}) // re-read as this editor
          await navigate({href: redirect})
        }}
      >
        {(busy) => (
          <button className="publish" disabled={busy}>
            {busy ? t('Signing in…') : t('Sign in')}
          </button>
        )}
      </SignInForm>
    </main>
  )
}
