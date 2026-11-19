import {queryOptions, useQuery} from '@tanstack/react-query'
import {meQueryOf} from './me-query'
import {createServerFn} from '@tanstack/react-start'
import {accountRequestReset, accountSignIn, cloudSignIn, currentEditor, describeToken, displayName, editorKey, knownTokenSelf, presenceName, signIn, signInMode, SignInRefused, signInRequired, signOut} from '../server/auth'
import {bpFetch, requestToken} from '../server/barkpark'
import {stubPerson} from '../server/access-stub'
import {useT} from './i18n'
import {currentScopeQuery} from './scope-switch'
import {meOf, sessionEnded} from './me-of'
import {headStartAllowed} from './gate-head-start'

// Who is editing (server/auth.ts). Server functions: the session cookie is
// httpOnly and the token never leaves the server.

export const whoAmI = createServerFn({method: 'GET'}).handler(async () => {
  const editor = currentEditor()
  // J49: may this editor write? The token they work with says (dev sign-in: theirs; else
  // the studio's own). Signed out of dev sign-in: the sign-in screen takes over.
  // The display name (GET /v1/auth/me) only labels the user menu: asked beside the token
  // check, and given 400 ms (a slow /v1/auth/me held every cold load; it fills in next time).
  const named = editor ? displayName(editor.token) : undefined
  const self = signInRequired() && !editor ? undefined : await describeToken(editor?.token ?? requestToken())
  // The signed-in editor's own token is dead (revoked or expired, 401): their session
  // ends here, and signing in again mints a new one (J48), not a refused-studio card.
  const ended = sessionEnded(editor, self)
  if (ended) void signOut()
  const me = meOf({
    mode: signInMode(),
    cloud: !!cloudSignIn(),
    editor,
    self,
    name: ended || !named ? null : await Promise.race([named, new Promise<null>((r) => setTimeout(r, 400, null))]),
    presenceName: editor ? presenceName(editor.email) : null,
    editorKey: editor ? editorKey(editor.email) : null,
  })
  // e2e only (server/access-stub.ts): a signed-in person with no seat here, until one is given.
  const stand = stubPerson()
  return stand && !stand.seated ? {...me, email: stand.email, noSeat: true} : me
})

/** A server render: may the pane chain's first reads start beside whoAmI (lib/gate-head-start.ts)? From the cookie and memory, never a Barkpark read. */
export const chainMayStart = createServerFn({method: 'GET'}).handler(async () => headStartAllowed(signInMode(), currentEditor(), requestToken(), knownTokenSelf))

/**
 * task-f2bc22f7401aae9e: who is signed in when Barkpark is too slow to say more, for the
 * server render. From the session cookie alone (no Barkpark read), so a signed-in editor is
 * never shown signed out; and with no right to write or publish until the browser's own
 * whoAmI answers (it asks at once), so a slow Barkpark never opens an action a role forbids.
 */
export const provisionalMe = createServerFn({method: 'GET'}).handler(async () => {
  const editor = currentEditor()
  const mode = signInMode()
  return {
    signIn: mode,
    devLogin: mode === 'dev',
    cloud: !!cloudSignIn(),
    email: editor?.email ?? null,
    name: null,
    role: null,
    userId: null,
    presenceName: editor ? presenceName(editor.email) : null,
    editorKey: editor ? editorKey(editor.email) : null,
    canWrite: false,
    canPublish: false,
    boundDataset: null,
    studioTokenRefused: false,
    noSeat: false,
    provisional: true as boolean,
    unchecked: false,
  }
})

export const devSignIn = createServerFn({method: 'POST'})
  .validator((d: {email: string}) => d)
  .handler(async ({data}) => {
    if (!/^[^@\s]+@[^@\s]+$/.test(data.email.trim())) throw new Error('That does not look like an email address.')
    await signIn(data.email)
    return {ok: true}
  })

/**
 * J67: sign in with a Barkpark account. Refusals come back as data (the words to show
 * and whether to ask for the TOTP code), not as a thrown server error.
 */
export const signInWithAccount = createServerFn({method: 'POST'})
  .validator((d: {email: string; password: string; code?: string}) => d)
  .handler(async ({data}): Promise<{ok: true} | {ok: false; code: string; message: string}> => {
    try {
      await accountSignIn(data.email, data.password, data.code || undefined)
      return {ok: true}
    } catch (e) {
      if (e instanceof SignInRefused) return {ok: false, code: e.code, message: e.message}
      return {ok: false, code: 'unreachable', message: 'Barkpark could not be reached. Try again.'}
    }
  })

/** Forgot password: Barkpark mails a reset link (server/auth.ts accountRequestReset). */
export const requestPasswordReset = createServerFn({method: 'POST'})
  .validator((d: {email: string}) => d)
  .handler(async ({data}): Promise<{ok: boolean}> => {
    try {
      await accountRequestReset(data.email)
      return {ok: true}
    } catch {
      return {ok: false}
    }
  })

export const endSession = createServerFn({method: 'POST'}).handler(async () => (await signOut(), {ok: true}))

// who-am-I's query (lib/me-query.ts), and which answer the session made: only the one whoAmI's
// latest completed ask returned in the browser. lib/person-source.ts believes no other.
const asked = meQueryOf(() => whoAmI())
export const meQuery = asked.query
export const madeBySession = asked.isMade

/**
 * J49: can this editor change things, and if not, the reason to show on what is
 * locked (Sanity's permission banner wording; Barkpark's read-only role reads as
 * Viewer, its contributor seat as Contributor: drafts, but nothing published changes).
 */
export function useCanWrite() {
  const t = useT()
  const {data: me} = useQuery(meQuery)
  const canWrite = me?.canWrite !== false
  const canPublish = canWrite && me?.canPublish !== false
  // A provisional answer (Barkpark was slow for the server render): nothing is allowed yet,
  // and the reason says so, not a role the editor may not have.
  const checking = !!me?.provisional
  return {
    canWrite,
    canPublish,
    /** Sign-in is on and nobody is signed in any more. */
    signedOut: !!me && me.signIn !== 'shared' && !me.email,
    editReason: canWrite ? undefined : checking ? t('Checking your access…') : t('Your role Viewer does not have permission to edit this document.'),
    publishReason: checking && !canPublish ? t('Checking your access…') : !canWrite ? t('Your role Viewer does not have permission to publish this document.') : canPublish ? undefined : t('Your role Contributor does not have permission to publish this document.'),
    unpublishReason: checking && !canPublish ? t('Checking your access…') : !canWrite ? t('Your role Viewer does not have permission to unpublish this document.') : canPublish ? undefined : t('Your role Contributor does not have permission to unpublish this document.'),
    /** Deleting a published document unpublishes it too: a Contributor deletes drafts only. */
    deletePublishedReason: checking && !canPublish ? t('Checking your access…') : !canWrite ? t('Your role Viewer does not have permission to delete this document.') : canPublish ? undefined : t('Your role Contributor does not have permission to delete this document.'),
    createReason: canWrite ? undefined : t('Your role Viewer does not have permission to create documents.'),
    commentReason: canWrite ? undefined : t('Your role Viewer does not have permission to comment on this document.'),
  }
}

/**
 * The dataset this page's token is bound to (Barkpark #22393) when the page is in another
 * one: every read here fails, and that is the reason to show (not "Could not fetch", not
 * "Trying to connect…"). Null otherwise.
 */
export function useBoundElsewhere(): {bound: string; here: {workspace: string; project: string; dataset: string}} | null {
  const bound = useQuery(meQuery).data?.boundDataset
  const here = useQuery(currentScopeQuery).data
  return bound && here && here.dataset !== bound ? {bound, here} : null
}

/** The studio's own Barkpark token is refused: the reason every read and save fails. */
export const useStudioTokenRefused = () => !!useQuery(meQuery).data?.studioTokenRefused

