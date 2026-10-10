// Per-editor Barkpark tokens. Every editor reads and writes with a token of their
// own, so each has their own rate budget and history shows who did what.
//
// Three ways in (signInMode):
// - account (J67): the editor signs in with their Barkpark account (email, password,
//   a TOTP code when the account has one). The default in a production build.
// - dev (STUDIO_DEV_LOGIN=1, dev builds only): the editor just names their email and the
//   studio server mints them a token with BARKPARK_ADMIN_TOKEN (below). Who you are is
//   asserted, not proven, so it never runs in a production build.
// - shared (STUDIO_SIGN_IN=shared, and any dev build without the dev flag): nobody signs
//   in; the studio uses BARKPARK_TOKEN for everyone (CI, e2e lanes).
//
// Dev sign-in (option B, 2026-10-05) mints through POST /v1/auth/app-tokens with the
// admin token, which lives only in a developer's local .env (never CI, never a deploy).
//
// One live token per workspace and editor, shared by every worktree and lane on this
// machine (scripts/lib/dev-tokens.mjs, ~/.cache/barkpark-studio/dev-tokens.json): a new
// worktree reuses it instead of minting. Barkpark app tokens don't expire, so a dead
// one is replaced and every leftover swept (scripts/revoke-dev-tokens.mjs; the e2e
// rig's teardown sweeps after a dev sign-in run). Signing out keeps the token: other
// sessions and lanes use the same one.
import '@tanstack/react-start/server-only'
import {randomBytes} from 'node:crypto'
import {devToken, editorPermissions, keepDevToken, sweepDevTokens} from '../../../scripts/lib/dev-tokens.mjs'
import {getCookie, setCookie, deleteCookie} from '@tanstack/react-start/server'
import {scope} from './barkpark'

export type SignInMode = 'account' | 'dev' | 'shared'
export function signInMode(): SignInMode {
  if (process.env.STUDIO_DEV_LOGIN === '1') return 'dev'
  const asked = process.env.STUDIO_SIGN_IN
  if (asked === 'account' || asked === 'shared') return asked
  return import.meta.env.PROD ? 'account' : 'shared'
}
export const devLoginEnabled = () => signInMode() === 'dev'
/** Someone has to sign in before the studio reads or writes as them. */
export const signInRequired = () => signInMode() !== 'shared'

if (devLoginEnabled() && import.meta.env.PROD)
  throw new Error('STUDIO_DEV_LOGIN is dev-only and refused in a production build: it trusts an email without a password.')

const COOKIE = 'bp_sid'
const SESSION_SECONDS = 60 * 60 * 12
// `session`: an account sign-in's Barkpark login session, kept only to sign it out.
type Editor = {email: string; token: string; permissions: string[]; session?: string}
const sessions = new Map<string, Editor>()

/** The signed-in editor for this request, if any. */
export function currentEditor(): Editor | undefined {
  if (!signInRequired()) return undefined
  const sid = getCookie(COOKIE)
  return sid ? sessions.get(sid) : undefined
}

const startSession = async (editor: Omit<Editor, 'permissions'>) => {
  const sid = randomBytes(24).toString('base64url')
  sessions.set(sid, {...editor, permissions: await tokenPermissions(editor.token)})
  setCookie(COOKIE, sid, {httpOnly: true, sameSite: 'lax', secure: import.meta.env.PROD, path: '/', maxAge: SESSION_SECONDS})
}

/** Dev sign-in: an email, no password (dev builds only). */
export async function signIn(email: string) {
  if (!devLoginEnabled()) throw new Error('dev login is off')
  await startSession({email, token: await editorToken(email.trim().toLowerCase())})
}

/** Why an account sign-in was refused, in words for the sign-in screen. */
export class SignInRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * J67: sign in with a Barkpark account. The password is used for this one request
 * (Barkpark's login, then its re-check when minting) and never kept. `code` is the
 * account's TOTP code, asked for when Barkpark answers mfa_required.
 */
export async function accountSignIn(email: string, password: string, code?: string) {
  if (signInMode() !== 'account') throw new Error('account sign-in is off')
  const url = process.env.BARKPARK_URL!
  const res = await fetch(`${url}/v1/auth/login`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({email: email.trim(), password, ...(code && {totp_code: code.trim()})}),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json().catch(() => ({}))) as {token?: string; user?: {email?: string}; error?: {code?: string; message?: string}}
  if (!res.ok || !body.token) throw new SignInRefused(body.error?.code ?? `http_${res.status}`, body.error?.message ?? `Barkpark answered ${res.status}`)
  const session = body.token
  try {
    await startSession({email: body.user?.email ?? email.trim().toLowerCase(), token: await dataToken(session, password), session})
  } catch (e) {
    void endBarkparkSession(session)
    throw e
  }
}

/**
 * The token an account editor reads and writes with. Barkpark's login session is not
 * accepted on the scoped data API yet (task-ce99fd602a697010), so the session mints a
 * personal token for this workspace, bound to the person, expiring with our cookie
 * (POST /v1/auth/tokens re-checks the password). When the session works there, this
 * returns the session and the exchange goes.
 *
 * Known gap: Barkpark caps a self-minted token at a member's minting policy, [read], though
 * a member seat writes. So a member who signs in here gets the Viewer banner and can't
 * edit until the session itself is the token (task-a89ef18ee88ba6a0; branch
 * feat/j67-session-token is ready for it).
 */
async function dataToken(session: string, password: string): Promise<string> {
  const res = await fetch(`${process.env.BARKPARK_URL}/v1/auth/tokens`, {
    method: 'POST',
    headers: {authorization: `Bearer ${session}`, 'content-type': 'application/json'},
    body: JSON.stringify({workspace: scope().workspace, ttl_seconds: SESSION_SECONDS, name: 'Barkpark Studio sign-in', current_password: password}),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json().catch(() => ({}))) as {token?: string; error?: {code?: string; message?: string}}
  if (!res.ok || !body.token) throw new SignInRefused(body.error?.code ?? `http_${res.status}`, body.error?.message ?? `Barkpark answered ${res.status}`)
  return body.token
}

/** Sign out at Barkpark too (best effort): the personal token, then the login session. */
async function endBarkparkSession(session: string, token?: string) {
  const url = process.env.BARKPARK_URL!
  const end = (path: string, bearer: string) => fetch(`${url}${path}`, {method: 'DELETE', headers: {authorization: `Bearer ${bearer}`}, signal: AbortSignal.timeout(5000)}).catch(() => undefined)
  if (token && token !== session) await end('/v1/auth/app-tokens/current', token)
  await end('/v1/auth/logout', session)
}

export async function signOut() {
  const sid = getCookie(COOKIE)
  const editor = sid ? sessions.get(sid) : undefined
  if (sid) sessions.delete(sid)
  deleteCookie(COOKIE, {path: '/'})
  // Dev sign-in keeps its token (other sessions and lanes share it); an account's ends.
  if (editor?.session) await endBarkparkSession(editor.session, editor.token)
}

const admin = () => {
  const t = process.env.BARKPARK_ADMIN_TOKEN
  if (!t) throw new Error('STUDIO_DEV_LOGIN needs BARKPARK_ADMIN_TOKEN in your local .env')
  return t
}

/** Reuse the editor's token if it still works; otherwise sweep their leftovers and mint one. */
async function editorToken(email: string): Promise<string> {
  const url = process.env.BARKPARK_URL!
  // B02: the token is minted for the workspace the sign-in happened in, and no dataset:
  // a token minted with one is bound to it (Barkpark, 2026-10-09), and an editor switches.
  const {workspace, project, dataset} = scope()
  const held = devToken(workspace, email)
  // The editor's configured permissions (a read-only editor stays read-only).
  const permissions = editorPermissions(email)
  if (held) {
    const probe = await fetch(`${url}/w/${workspace}/p/${project}/v1/schemas/${dataset}`, {headers: {authorization: `Bearer ${held}`}})
    // Dead (revoked or expired) is 401 everywhere since Barkpark #22517: then a new one.
    // One that may do more or less than this editor is configured for: a new one too.
    if (probe.status !== 401 && (await describeToken(held)).permissions.join() === permissions.join()) return held
    keepDevToken(workspace, email, undefined)
  }
  // Whatever this editor still has live is a leftover now (rate-limit aware, never silent).
  await sweepDevTokens({url, admin: admin(), emails: [email]}).catch((e) => console.warn('[dev sign-in] sweep:', (e as Error).message))
  const res = await fetch(`${url}/v1/auth/app-tokens`, {
    method: 'POST',
    headers: {authorization: `Bearer ${admin()}`, 'content-type': 'application/json'},
    body: JSON.stringify({email, workspace, permissions, label: `app:${email}`}),
  })
  if (!res.ok) throw new Error(`minting an editor token for ${email}: ${res.status} ${await res.text()}`)
  const {token} = (await res.json()) as {token: string}
  keepDevToken(workspace, email, token)
  return token
}

/**
 * What a token may do (J49 and the roles scout: a read-only role sees a locked form,
 * not refused writes): the token describes itself (GET /v1/auth/token, barkpark#22130),
 * its permissions as far as its seat in the workspace allows, and the dataset it is held
 * to when bound (#22393). Kept a minute per token. Unknown: Barkpark judges each write.
 */
export type TokenSelf = {permissions: string[]; boundDataset: string | null; refused?: boolean}
const described = new Map<string, {at: number; self: Promise<TokenSelf>}>()
export function describeToken(token: string): Promise<TokenSelf> {
  const held = described.get(token)
  if (held && Date.now() - held.at < 60_000) return held.self
  const self = (async (): Promise<TokenSelf> => {
    const res = await fetch(`${process.env.BARKPARK_URL}/v1/auth/token`, {headers: {authorization: `Bearer ${token}`}}).catch(() => undefined)
    // 401: dead (revoked or expired). 403: alive but not allowed here: nothing to write with.
    if (res?.status === 401) return {permissions: [], boundDataset: null, refused: true}
    if (res?.status === 403) return {permissions: [], boundDataset: null}
    if (!res?.ok) return {permissions: ['read', 'write'], boundDataset: null}
    const me = (await res.json()) as {permissions?: string[]; seat?: {can?: Record<string, boolean>}; dataset?: string; dataset_bound?: boolean}
    return {permissions: (me.permissions ?? ['read', 'write']).filter((p) => me.seat?.can?.[p] !== false), boundDataset: me.dataset_bound && me.dataset ? me.dataset : null}
  })()
  described.set(token, {at: Date.now(), self})
  return self
}
const tokenPermissions = async (token: string) => (await describeToken(token)).permissions

