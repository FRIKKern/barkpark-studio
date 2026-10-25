import {useQuery, useQueryClient} from '@tanstack/react-query'
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
  validateSearch: (s: Record<string, unknown>) => ({redirect: returnPath(s.redirect), ...(isCloudError(s.cloud_error) && {cloud_error: s.cloud_error})}),
  // Signed in already: straight on to where they were going. Sanity never shows a
  // signed-in editor its sign-in screen (task-701f8a5fdb6b4d52).
  beforeLoad: async ({context, search}) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (me.signIn !== 'shared' && me.email) throw redirect({href: search.redirect})
  },
  component: Login,
})

// Why a Barkpark Cloud sign-in came back refused (routes/auth/cloud/callback.ts).
const CLOUD_ERRORS = ['state', 'ticket', 'not_seated', 'unavailable'] as const
type CloudError = (typeof CLOUD_ERRORS)[number]
const isCloudError = (v: unknown): v is CloudError => (CLOUD_ERRORS as readonly unknown[]).includes(v)

function Login() {
  useHydratedMark()
  const t = useT()
  const {redirect, cloud_error} = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const {data: me} = useQuery(meQuery)
  const cloudRefused: Record<CloudError, string> = {
    not_seated: t("You don't have access to this workspace yet. Ask an administrator for a seat."),
    state: t('That sign-in took too long or began in another browser. Try again.'),
    ticket: t('Barkpark Cloud could not sign you in. Try again.'),
    unavailable: t('Barkpark could not be reached. Try again.'),
  }
  return (
    <main className="login">
      <SignInForm
        heading={<h1>Barkpark Studio</h1>}
        above={
          (me?.cloud || cloud_error) && (
            <>
              {cloud_error && (
                <p className="field-error" role="alert">
                  {cloudRefused[cloud_error]}
                </p>
              )}
              {me?.cloud && (
                <>
                  <a className="publish sign-in-cloud" href={`/auth/cloud/start?redirect=${encodeURIComponent(redirect)}`}>
                    {t('Sign in with Barkpark Cloud')}
                  </a>
                  <p className="sign-in-or">{t('or with email and password')}</p>
                </>
              )}
            </>
          )
        }
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
