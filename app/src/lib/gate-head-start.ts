// task-349280f0addcf251: a server render asked Barkpark who this is (`me`), and only then
// started the pane chain's first reads (the desk and the schemas), one round trip after the
// other. When the session cookie already says the gate will pass (shared sign-in, or a
// signed-in editor whose token Barkpark has not refused), those two reads start now, beside
// `me`. They run with the tokens they always use (server/schemas.ts), on a client of their
// own: nothing of them reaches the page unless `me` then lets this person in (signed in, a
// seat, the studio's token alive). Otherwise they are dropped and the page is what it was:
// the redirect to /login, or the chain read again.
import {serviceAccess, type TokenSelf} from './token-self.ts'

export type Gate<M, H> = {
  /** The session cookie alone (no Barkpark read): would the gate let this request in? */
  cookieLetsIn: () => Promise<boolean>
  /** Who this is, from Barkpark. */
  readMe: () => Promise<M>
  /** The head start: the chain's first reads, begun. */
  start: () => H
  /** `me` lets this person see the structure: only then is the head start used. */
  letsIn: (me: M) => boolean
}

/** `me`, read with the chain's first reads running beside it; `ahead` only when `me` lets this person in. */
export async function readMeWithHeadStart<M, H>({cookieLetsIn, readMe, start, letsIn}: Gate<M, H>): Promise<{me: M; ahead?: H}> {
  const ahead = (await cookieLetsIn()) ? start() : undefined
  const me = await readMe()
  return ahead !== undefined && letsIn(me) ? {me, ahead} : {me}
}

export type Me = {signIn: string; email: string | null; noSeat?: boolean; studioTokenRefused?: boolean}

/** In, and able to read: signed in (or shared sign-in), a seat here, the studio's token alive. */
export const letsIn = (me: Me) => (me.signIn === 'shared' || !!me.email) && !me.noSeat && !me.studioTokenRefused

/**
 * From the session cookie and what Barkpark last said of its token (`known`: held in memory,
 * never a Barkpark read): may the chain's reads start before `me` answers? Not when signed out,
 * nor for a token Barkpark refused or that has no seat here: those are read by `me` alone.
 */
export async function headStartAllowed(mode: string, editor: {token: string} | undefined, studioToken: string, known: (token: string) => Promise<TokenSelf> | undefined): Promise<boolean> {
  if (mode !== 'shared' && !editor) return false
  const said = known(editor?.token ?? studioToken)
  if (!said) return true
  const self = await said
  return !self.refused && !(editor && serviceAccess(self) === 'no_seat')
}

/** A server render's head start, from requireEditor to the route's loader: held per request, never in route context (that goes to the browser). */
export function handOff<K extends object, H>() {
  const held = new WeakMap<K, H>()
  return {
    put: (key: K, h: H) => void held.set(key, h),
    take: (key: K) => {
      const h = held.get(key)
      held.delete(key)
      return h
    },
  }
}
