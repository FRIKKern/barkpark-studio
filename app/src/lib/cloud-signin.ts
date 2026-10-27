// Sign in with Barkpark Cloud (task-74c3c0ab88eb4f53): the editor proves who they are to
// Barkpark Cloud (the account `bp login` uses), Cloud sends them back here with a
// single-use 60 s ticket, and this server trades the ticket at Barkpark for a login
// session, the same kind a password sign-in gets (server/auth.ts accountSignIn).
//
//   /auth/cloud/start ── 302 ──▶ <cloud>/studio-signin?instance&return_to&state&code_challenge
//   <cloud> (signed in, team member, return_to on the instance's allowlist) ── 302 ──▶
//   /auth/cloud/callback?ticket&state ── POST <barkpark>/v1/auth/login-tickets/exchange
//
// STUDIO_SIGN_IN=sso (task-8bdf1b15305af840) runs the same round trip through the
// instance's own OIDC instead: /auth/cloud/start ── 302 ──▶ <barkpark>/v1/auth/oidc/<org>/start,
// the identity provider, then Barkpark's callback ── 302 ──▶ /auth/cloud/callback, and the
// ticket is traded at POST <barkpark>/v1/auth/sso/exchange (ssoConfig).
//
// `state` (in an HttpOnly cookie) ties the callback to the browser that started; the
// PKCE verifier (S256) ties the ticket to this server, so a ticket read off a log or a
// URL is worth nothing without it. Pure but for `fetch`, so it has a fast test.
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto'
import {serviceAccess, tokenSelf, type TokenBody} from './token-self.ts'

export const CLOUD_COOKIE = 'bp_cloud'
export const CLOUD_PATH = '/auth/cloud'
export const CLOUD_TTL_SECONDS = 600

/** Where the editor proves who they are (`start`, with `params`), and the Barkpark path that trades the ticket. */
export type CloudConfig = {start: string; params: Record<string, string>; exchange: string}
/** What the start leaves in the cookie for the callback (sealed). */
export type CloudPending = {state: string; verifier: string; origin: string; redirect: string; exp: number}
export type CloudError = 'state' | 'ticket' | 'not_seated' | 'unavailable'

/** On only for account sign-in, with both BARKPARK_CLOUD_URL and BARKPARK_CLOUD_INSTANCE set. */
export function cloudConfig(env: Record<string, string | undefined>, accountMode: boolean): CloudConfig | undefined {
  const cloudUrl = env.BARKPARK_CLOUD_URL?.trim().replace(/\/+$/, '')
  const instance = env.BARKPARK_CLOUD_INSTANCE?.trim()
  return accountMode && cloudUrl && instance ? {start: `${cloudUrl}/studio-signin`, params: {instance}, exchange: '/v1/auth/login-tickets/exchange'} : undefined
}

/** STUDIO_SIGN_IN=sso: the instance's OIDC sign-in for the organization STUDIO_SSO_ORG names. */
export function ssoConfig(env: Record<string, string | undefined>): CloudConfig | undefined {
  const barkparkUrl = env.BARKPARK_URL?.trim().replace(/\/+$/, '')
  const org = env.STUDIO_SSO_ORG?.trim()
  return barkparkUrl && org ? {start: `${barkparkUrl}/v1/auth/oidc/${encodeURIComponent(org)}/start`, params: {}, exchange: '/v1/auth/sso/exchange'} : undefined
}

/** This studio's public origin: STUDIO_PUBLIC_URL when set, else the request's. */
export function publicOrigin(env: Record<string, string | undefined>, requestUrl: string): string {
  return new URL(env.STUDIO_PUBLIC_URL?.trim() || requestUrl).origin
}

const b64url = (b: Buffer) => b.toString('base64url')
export const challengeOf = (verifier: string) => b64url(createHash('sha256').update(verifier).digest())

/** The pending sign-in to seal in the cookie, and where to send the browser. */
export function cloudStart(cfg: CloudConfig, origin: string, redirect: string, now = Date.now()): {pending: CloudPending; location: string} {
  const pending: CloudPending = {state: b64url(randomBytes(32)), verifier: b64url(randomBytes(32)), origin, redirect, exp: Math.floor(now / 1000) + CLOUD_TTL_SECONDS}
  const q = new URLSearchParams({...cfg.params, return_to: `${origin}${CLOUD_PATH}/callback`, state: pending.state, code_challenge: challengeOf(pending.verifier)})
  return {pending, location: `${cfg.start}?${q}`}
}

/** The callback came back to the browser that started it, in time. */
export function stateMatches(pending: CloudPending | undefined, state: unknown, now = Date.now()): pending is CloudPending {
  if (!pending || typeof pending.state !== 'string' || typeof pending.verifier !== 'string' || typeof pending.exp !== 'number') return false
  if (pending.exp * 1000 <= now || typeof state !== 'string') return false
  const a = Buffer.from(pending.state)
  const b = Buffer.from(state)
  return a.length === b.length && timingSafeEqual(a, b)
}

type Fetch = typeof fetch

/**
 * Trade the ticket for a login session, and keep it only if it is seated in `workspace`
 * (a session with no seat here is signed out again at Barkpark). Never logs the ticket
 * or the session.
 */
export async function cloudExchange(opts: {barkparkUrl: string; exchange: string; ticket: unknown; pending: CloudPending; workspace: string; fetch?: Fetch}): Promise<{ok: true; email: string; token: string} | {ok: false; error: CloudError}> {
  const f = opts.fetch ?? fetch
  if (typeof opts.ticket !== 'string' || !opts.ticket) return {ok: false, error: 'ticket'}
  let res: Response
  try {
    res = await f(`${opts.barkparkUrl}${opts.exchange}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({ticket: opts.ticket, audience: opts.pending.origin, code_verifier: opts.pending.verifier}),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return {ok: false, error: 'unavailable'}
  }
  if (res.status !== 201) return {ok: false, error: res.status >= 500 ? 'unavailable' : 'ticket'}
  const body = (await res.json().catch(() => ({}))) as {token?: string; user?: {email?: string}}
  if (!body.token || !body.user?.email) return {ok: false, error: 'ticket'}
  const auth = {authorization: `Bearer ${body.token}`}
  const self = await f(`${opts.barkparkUrl}/v1/auth/token`, {headers: auth, signal: AbortSignal.timeout(10_000)})
    .then(async (r) => (r.ok ? tokenSelf((await r.json()) as TokenBody, opts.workspace) : r.status === 401 || r.status === 403 ? {permissions: [], boundDataset: null} : undefined))
    .catch(() => undefined)
  if (!self || serviceAccess(self) !== 'ok') {
    await f(`${opts.barkparkUrl}/v1/auth/logout`, {method: 'DELETE', headers: auth, signal: AbortSignal.timeout(5000)}).catch(() => undefined)
    return {ok: false, error: self ? 'not_seated' : 'unavailable'}
  }
  return {ok: true, email: body.user.email, token: body.token}
}
