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
// One live token per editor: the raw value is only shown at mint, so it's kept in
// the gitignored .studio-dev-tokens.json; a lost one is revoked before minting
// the next. scripts/revoke-dev-tokens.mjs revokes them all.
import '@tanstack/react-start/server-only'
import {randomBytes} from 'node:crypto'
import {readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {getCookie, setCookie, deleteCookie} from '@tanstack/react-start/server'

export const devLoginEnabled = () => process.env.STUDIO_DEV_LOGIN === '1'

if (devLoginEnabled() && import.meta.env.PROD)
  throw new Error('STUDIO_DEV_LOGIN is dev-only and refused in a production build: it trusts an email without a password.')

const COOKIE = 'bp_sid'
const sessions = new Map<string, {email: string; token: string}>()
const TOKENS_FILE = resolve(process.cwd(), '../.studio-dev-tokens.json')

/** The signed-in editor for this request, if any. */
export function currentEditor(): {email: string; token: string} | undefined {
  if (!devLoginEnabled()) return undefined
  const sid = getCookie(COOKIE)
  return sid ? sessions.get(sid) : undefined
}

export async function signIn(email: string) {
  if (!devLoginEnabled()) throw new Error('dev login is off')
  const token = await editorToken(email.trim().toLowerCase())
  const sid = randomBytes(24).toString('base64url')
  sessions.set(sid, {email, token})
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

type TokenFile = {workspaceId?: string; tokens: Record<string, string>}
async function readTokens(): Promise<TokenFile> {
  return JSON.parse(await readFile(TOKENS_FILE, 'utf8').catch(() => '{"tokens": {}}'))
}

/** Reuse the editor's token if it still works; otherwise revoke what is left and mint one. */
async function editorToken(email: string): Promise<string> {
  const url = process.env.BARKPARK_URL
  const workspace = process.env.BARKPARK_WORKSPACE
  const file = await readTokens()
  const tokens = file.tokens
  if (tokens[email]) {
    const probe = await fetch(`${url}/w/${workspace}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/schemas/${process.env.BARKPARK_DATASET || 'production'}`, {
      headers: {authorization: `Bearer ${tokens[email]}`},
    })
    if (probe.status !== 401) return tokens[email]
  }
  await revokeEditorTokens(email, file.workspaceId)
  const res = await fetch(`${url}/v1/auth/app-tokens`, {
    method: 'POST',
    headers: {authorization: `Bearer ${admin()}`, 'content-type': 'application/json'},
    body: JSON.stringify({email, workspace, permissions: ['read', 'write'], label: `app:${email}`, dataset: process.env.BARKPARK_DATASET || 'production'}),
  })
  if (!res.ok) throw new Error(`minting an editor token for ${email}: ${res.status} ${await res.text()}`)
  const {token, workspace_id} = (await res.json()) as {token: string; workspace_id: string}
  await writeFile(TOKENS_FILE, JSON.stringify({workspaceId: workspace_id, tokens: {...tokens, [email]: token}}, null, 2))
  return token
}

/**
 * Revoke this studio's tokens for `email`: label app:<email>, in this workspace,
 * read/write only. The mobile app mints app:<email> tokens too (with chat), in
 * other workspaces; those are left alone.
 */
export async function revokeEditorTokens(email: string, workspaceId?: string) {
  const url = process.env.BARKPARK_URL
  const list = await fetch(`${url}/v1/auth/app-tokens?email=${encodeURIComponent(email)}`, {headers: {authorization: `Bearer ${admin()}`}})
  if (!list.ok) return
  const {tokens} = (await list.json()) as {tokens: {id: string; label: string; workspace_id: string; permissions: string[]; revoked_at: string | null}[]}
  for (const t of tokens)
    if (!t.revoked_at && t.label === `app:${email}` && (!workspaceId || t.workspace_id === workspaceId) && !t.permissions.includes('chat'))
      await fetch(`${url}/v1/auth/app-tokens/${t.id}`, {method: 'DELETE', headers: {authorization: `Bearer ${admin()}`}})
}
