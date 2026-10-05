import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {currentEditor, devLoginEnabled, signIn, signOut} from '../server/auth'

// Who is editing (server/auth.ts). Server functions: the session cookie is
// httpOnly and the token never leaves the server.

export const whoAmI = createServerFn({method: 'GET'}).handler(async () => ({
  devLogin: devLoginEnabled(),
  email: currentEditor()?.email ?? null,
}))

export const devSignIn = createServerFn({method: 'POST'})
  .validator((d: {email: string}) => d)
  .handler(async ({data}) => {
    if (!/^[^@\s]+@[^@\s]+$/.test(data.email.trim())) throw new Error('That does not look like an email address.')
    await signIn(data.email)
    return {ok: true}
  })

export const devSignOut = createServerFn({method: 'POST'}).handler(async () => (signOut(), {ok: true}))

export const meQuery = queryOptions({queryKey: ['me'], queryFn: () => whoAmI(), staleTime: Infinity})
