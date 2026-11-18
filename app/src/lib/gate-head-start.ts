// task-349280f0addcf251: a server render asked Barkpark who this is (`me`), and only then
// started the pane chain's first reads (the desk and the schemas), one round trip after the
// other. When the session cookie already says the gate will pass (shared sign-in, or a
// signed-in editor), those reads start now, beside `me`. They run with the tokens they always
// use (server/schemas.ts), on a client of their own: nothing of them reaches the page unless
// `me` then lets this person in (signed in, a seat, the studio's token alive). Otherwise they
// are dropped and the page is what it was: the redirect to /login, or the chain read again.

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
