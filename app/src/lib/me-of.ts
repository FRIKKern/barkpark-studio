// whoAmI's answer (lib/session.ts), from what the server read: the sign-in, the session's editor and
// Barkpark's word on their token (server/auth.ts describeToken). A plain function, so its test reads
// the mapping itself: a check Barkpark did not answer makes the person unknown, never nobody
// (task-4ffed14fbf52dc47; lib/conditions.ts currentUserOf reads `unchecked`).
import type {SignInMode} from '../server/auth.ts'
import {serviceAccess, type TokenSelf} from './token-self.ts'

export type Read = {
  mode: SignInMode
  /** Sign in with Barkpark Cloud is offered. */
  cloud: boolean
  /** The session's editor, or none (shared sign-in, or signed out). */
  editor: {email: string} | null | undefined
  /** Barkpark's word on the token: undefined when it was not asked (signed out of a required sign-in). */
  self: TokenSelf | undefined
  /** The display name, if Barkpark gave it in time. */
  name: string | null
  /** The editor's presence name and browser-storage key (server/auth.ts), or null. */
  presenceName: string | null
  editorKey: string | null
}

/** Whether the editor's own token is dead (revoked or expired, 401): their session ends. */
export const sessionEnded = (editor: Read['editor'], self: TokenSelf | undefined) => !!editor && !!self?.refused

export function meOf({mode, cloud, editor, self, name, presenceName, editorKey}: Read) {
  const ended = sessionEnded(editor, self)
  return {
    /** How editors sign in: their Barkpark account, dev (an email), or nobody (shared). */
    signIn: mode,
    devLogin: mode === 'dev',
    cloud,
    email: ended ? null : editor?.email ?? null,
    /** task-701f8a5fdb6b4d52, the user menu as Sanity's: their name (Barkpark display name) and role here. */
    name: ended ? null : name,
    role: ended || !editor ? null : self?.role ?? null,
    /** Help > Diagnostics: the Barkpark user behind a login session. */
    userId: ended || !editor ? null : self?.userId ?? null,
    /** J07: the name this editor's presence goes by, so their own tabs can be left out (Sanity's). Shared sign-in: none. */
    presenceName: ended || !editor ? null : presenceName,
    /** The editor in browser storage keys: a digest, never the email. */
    editorKey: ended || !editor ? null : editorKey,
    canWrite: self && !ended ? self.permissions.includes('write') : true,
    canPublish: self && !ended ? self.canPublish !== false : true,
    /** A token held to one dataset (Barkpark #22393): the only one it can open. */
    boundDataset: self?.boundDataset ?? null,
    /** The studio's own token is refused (revoked, or out of the workspace): nothing will load. */
    studioTokenRefused: !editor && !!self?.refused,
    /** Signed in, but with no seat in this workspace (or it doesn't exist): Sanity's no-access screen. */
    noSeat: !!editor && !ended && !!self && serviceAccess(self) === 'no_seat',
    /** Barkpark's answer (false), or provisionalMe's stand-in while it is late (true). */
    provisional: false as boolean,
    /** Barkpark did not answer the check (describeToken's UNKNOWN_SELF): who this is stays unknown, and the page offers a retry. */
    unchecked: !ended && !!self?.unknown,
  }
}
