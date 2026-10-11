// Dev sign-in tokens (app/src/server/auth.ts), one live token per workspace and editor,
// shared by every worktree and lane on this machine (tokens are workspace-scoped, not
// held to a dataset), so a new worktree reuses instead of minting. Barkpark app tokens
// have no expiry, so leftovers are swept (sweep below; the e2e rig's teardown runs it).
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join} from 'node:path'

export const devTokensFile = () => process.env.STUDIO_DEV_TOKENS_FILE || join(homedir(), '.cache', 'barkpark-studio', 'dev-tokens.json')
const key = (workspace, email) => `${workspace}|${email}`

/** {"<workspace>|<email>": token} */
export function readDevTokens() {
  try {
    return JSON.parse(readFileSync(devTokensFile(), 'utf8')).tokens ?? {}
  } catch {
    return {}
  }
}
export const devToken = (workspace, email) => readDevTokens()[key(workspace, email)]
export function keepDevToken(workspace, email, token) {
  const file = devTokensFile()
  mkdirSync(dirname(file), {recursive: true})
  const tokens = {...readDevTokens(), [key(workspace, email)]: token}
  if (!token) delete tokens[key(workspace, email)]
  writeFileSync(file, JSON.stringify({tokens}, null, 2), {mode: 0o600})
}

/** DELETE with Barkpark's rate limit honoured: a 429 waits its Retry-After and tries again. */
async function revoke(url, admin, id) {
  for (let i = 0; i < 8; i++) {
    const res = await fetch(`${url}/v1/auth/app-tokens/${id}`, {method: 'DELETE', headers: {authorization: `Bearer ${admin}`}})
    if (res.status !== 429) return res.ok
    await new Promise((r) => setTimeout(r, Math.min(Number(res.headers.get('retry-after')) || 2, 30) * 1000))
  }
  return false
}

/**
 * Revoke the live dev sign-in tokens (label "app:<email>") that are not the kept one for
 * their editor; `everything` revokes the kept ones too. Returns how many were revoked and
 * how many could not be.
 */
// What each dev editor may do: dev sign-in mints exactly this (task-c9877a98acaaf8e4: a
// full token for read-only editor d made J63 "see another editor's draft"), and
// scripts/rig-editor-tokens.mjs mints editor d from it too. Not listed: read and write.
export const EDITOR_PERMISSIONS = {'studio-editor-d@example.com': ['read']}
export const editorPermissions = (email) => EDITOR_PERMISSIONS[email.toLowerCase()] ?? ['read', 'write']

// Only the dev sign-in's own editors (a, b): never a studio's, a lane's or a person's token,
// nor the rig's editors c and d (scripts/rig-editor-tokens.mjs mints and revokes those).
export const DEV_EDITOR = /^studio-editor-[ab]@example\.com$/

export async function sweepDevTokens({url, admin, everything = false, emails}) {
  const res = await fetch(`${url}/v1/auth/app-tokens`, {headers: {authorization: `Bearer ${admin}`}})
  if (!res.ok) throw new Error(`listing app tokens: ${res.status}`)
  const kept = new Set(everything ? [] : Object.values(readDevTokens()))
  const keptIds = new Set()
  // The listing names tokens by id, not value: a kept token is found by asking it who it is.
  for (const token of kept) {
    const self = await fetch(`${url}/v1/auth/token`, {headers: {authorization: `Bearer ${token}`}}).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (self?.id ?? self?.token_id) keptIds.add(self.id ?? self.token_id)
  }
  let revoked = 0
  let failed = 0
  for (const t of (await res.json()).tokens ?? []) {
    const email = /^app:(.+)$/.exec(t.label ?? '')?.[1]
    if (!email || !DEV_EDITOR.test(email) || t.revoked_at || (emails && !emails.includes(email)) || t.permissions?.includes('chat') || keptIds.has(t.id)) continue
    ;(await revoke(url, admin, t.id)) ? revoked++ : failed++
  }
  if (everything) writeFileSync(devTokensFile(), JSON.stringify({tokens: {}}, null, 2), {mode: 0o600})
  return {revoked, failed, kept: keptIds.size}
}
