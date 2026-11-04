// How long a studio session lasts (server/auth.ts). Two clocks, in unix seconds:
// - exp, the idle window: IDLE_SECONDS after the last renewal. Work keeps sliding it.
// - abs, the absolute end (task-4c981126f9255b29): when the instance ends the login
//   session behind it. Barkpark's GET /v1/auth/token answers it as `expires_at`, the
//   earlier of the session's own expiry and the age cap of the organization's session
//   policy. Work never moves it, so an active editor signs in again at that moment.
// Pure, so the clock has a fast test (session-age.test.ts).

export const IDLE_SECONDS = 60 * 60 * 12

export type SessionClock = {exp: number; abs?: number}

/** Barkpark's `expires_at` (ISO-8601) in unix seconds; undefined when it names none. */
export function absoluteEnd(expiresAt: unknown): number | undefined {
  if (typeof expiresAt !== 'string') return undefined
  const ms = Date.parse(expiresAt)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

/** A fresh idle window from `now`, never past the absolute end, and the cookie's maxAge for it. */
export function sessionWindow(now: number, abs?: number): {exp: number; maxAge: number} {
  const exp = Math.floor(abs === undefined ? now + IDLE_SECONDS : Math.min(now + IDLE_SECONDS, abs))
  return {exp, maxAge: Math.max(0, Math.floor(exp - now))}
}

/**
 * One request against a sealed session. `known` is the absolute end Barkpark answered last
 * for this token: a number, null for none, undefined when not asked yet. What it says wins
 * over what the cookie holds, so a changed session policy reaches a session already open.
 * Closed: the editor signs in again. `renew`: seal the session again with this clock.
 */
export function onRequest(clock: SessionClock, now: number, known?: number | null): {open: false} | {open: true; renew?: SessionClock} {
  const abs = known === undefined ? clock.abs : (known ?? undefined)
  if (now >= clock.exp || (abs !== undefined && now >= abs)) return {open: false}
  // In use past half its time, or past a sooner end: a fresh window, up to the end.
  const halfGone = clock.exp - now < IDLE_SECONDS / 2
  const capped = abs !== undefined && clock.exp > abs
  const exp = halfGone || capped ? sessionWindow(now, abs).exp : clock.exp
  if (exp === clock.exp && abs === clock.abs) return {open: true}
  return {open: true, renew: {exp, ...(abs !== undefined && {abs})}}
}
