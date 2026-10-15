import {useQueryClient} from '@tanstack/react-query'
import {createFileRoute, redirect, useNavigate} from '@tanstack/react-router'
import {SignInForm} from '../components/SignInForm'
import {useHydratedMark} from '../lib/hydrated'
import {useT} from '../lib/i18n'
import {returnPath} from '../lib/return-path'
import {editorIs, resumeSaving} from '../lib/edits'
import {meQuery} from '../lib/session'

// The sign-in screen (server/auth.ts): a Barkpark account (J67), or dev sign-in's email
// only. The seated dev test editors are studio-editor-{a..d}@example.com.
export const Route = createFileRoute('/login')({
  // Back where the editor was going: a path on this studio only (lib/return-path.ts).
  validateSearch: (s: Record<string, unknown>) => ({redirect: returnPath(s.redirect)}),
  // Signed in already: straight on to where they were going. Sanity never shows a
  // signed-in editor its sign-in screen (task-701f8a5fdb6b4d52).
  beforeLoad: async ({context, search}) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (me.signIn !== 'shared' && me.email) throw redirect({href: search.redirect})
  },
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
          // Edits held from a lost session (J48) go out if they are this editor's; anyone else's are dropped.
          if (editorIs(qc.getQueryData(meQuery.queryKey)?.email ?? null)) resumeSaving(qc)
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
