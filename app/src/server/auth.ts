// Per-editor Barkpark tokens. Every editor reads and writes with a token of their
// own, so each has their own rate budget and history shows who did what.
//
// DEV ONLY for now (option B, 2026-10-05): Barkpark's login can't yet give an
// external studio a usable editor token (task-287b009456a8591a), so with
// STUDIO_DEV_LOGIN=1 the editor just names their email and the studio server
// mints them a token through POST /v1/auth/app-tokens with BARKPARK_ADMIN_TOKEN.
// Who you are is asserted, not proven — so this never runs in a production build,
// and the admin token lives only in a developer's local .env (never CI, never a
// deploy). Without the flag the studio uses BARKPARK_TOKEN for everyone (CI).
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

export const devLoginEnabled = () => process.env.STUDIO_DEV_LOGIN === '1'

if (devLoginEnabled() && import.meta.env.PROD)
  throw new Error('STUDIO_DEV_LOGIN is dev-only and refused in a production build: it trusts an email without a password.')

const COOKIE = 'bp_sid'
type Editor = {email: string; token: string; permissions: string[]}
const sessions = new Map<string, Editor>()

/** The signed-in editor for this request, if any. */
export function currentEditor(): Editor | undefined {
  if (!devLoginEnabled()) return undefined
  const sid = getCookie(COOKIE)
  return sid ? sessions.get(sid) : undefined
}

export async function signIn(email: string) {
  if (!devLoginEnabled()) throw new Error('dev login is off')
  const token = await editorToken(email.trim().toLowerCase())
  const sid = randomBytes(24).toString('base64url')
  sessions.set(sid, {email, token, permissions: await tokenPermissions(token)})
  setCookie(COOKIE, sid, {httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 12})
}

export function signOut() {
  const sid = getCookie(COOKIE)
  if (sid) sessions.delete(sid)
  deleteCookie(COOKIE, {path: '/'})
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

