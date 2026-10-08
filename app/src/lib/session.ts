import {queryOptions, useQuery} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {currentEditor, devLoginEnabled, signIn, signOut} from '../server/auth'
import {useT} from './i18n'

// Who is editing (server/auth.ts). Server functions: the session cookie is
// httpOnly and the token never leaves the server.

export const whoAmI = createServerFn({method: 'GET'}).handler(async () => ({
  devLogin: devLoginEnabled(),
  email: currentEditor()?.email ?? null,
  // J49: may this editor write? (Without dev sign-in the studio token writes: yes.)
  canWrite: devLoginEnabled() && currentEditor() ? currentEditor()!.permissions.includes('write') : true,
}))

export const devSignIn = createServerFn({method: 'POST'})
  .validator((d: {email: string}) => d)
  .handler(async ({data}) => {
    if (!/^[^@\s]+@[^@\s]+$/.test(data.email.trim())) throw new Error('That does not look like an email address.')
    await signIn(data.email)
    return {ok: true}
  })

export const devSignOut = createServerFn({method: 'POST'}).handler(async () => (signOut(), {ok: true}))

// Re-asked when the window regains focus (J48): a session lost to a studio restart or
// an expired cookie shows up before the next edit, not only after it.
export const meQuery = queryOptions({queryKey: ['me'], queryFn: () => whoAmI(), staleTime: 30_000, refetchOnWindowFocus: true})

/**
 * J49: can this editor change things, and if not, the reason to show on what is
 * locked (Sanity's permission banner wording; Barkpark's read-only role reads as
 * Viewer).
 */
export function useCanWrite() {
  const t = useT()
  const {data: me} = useQuery(meQuery)
  const canWrite = me?.canWrite !== false
  return {
    canWrite,
    /** Dev sign-in is on and nobody is signed in any more. */
    signedOut: !!me?.devLogin && !me.email,
    editReason: canWrite ? undefined : t('Your role Viewer does not have permission to edit this document.'),
    publishReason: canWrite ? undefined : t('Your role Viewer does not have permission to publish this document.'),
    createReason: canWrite ? undefined : t('Your role Viewer does not have permission to create documents.'),
  }
}
