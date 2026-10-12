#!/usr/bin/env node
// Stale tokens the lanes, the rig and probes minted in this workspace (task-0b926def1700437e):
// live app tokens whose label starts with a minted prefix, older than --days (default 2),
// never one in use here (the lane tokens of every worktree beside this one and of this
// machine, the dev sign-in's kept tokens, the .env tokens). Lists only; --yes revokes the list, and only after the
// owner has approved it.
//   node --env-file=.env scripts/stale-tokens.mjs [--days 2] [--prefix lane:,rig:] [--yes]
// Revoking stops a token working; its member row stays (Barkpark keeps revoked members,
// 231 of 269 on 2026-10-11), so the members count is printed for that conversation too.
import {readdirSync, readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {readDevTokens} from './lib/dev-tokens.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const days = Number(arg('days', '2'))
const prefixes = arg('prefix', 'lane:,rig:,app:studio-editor-,app:revoke-,probe:,scout:,revoke-').split(',')
const url = process.env.BARKPARK_URL
const ws = process.env.BARKPARK_WORKSPACE
const admin = process.env.BARKPARK_ADMIN_TOKEN || process.env.BARKPARK_TOKEN
const headers = {authorization: `Bearer ${admin}`}
const json = async (path, h = headers) => {
  const res = await fetch(`${url}${path}`, {headers: h})
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}
const read = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return {}
  }
}

const workspace = (await json('/api/workspaces')).workspaces.find((w) => w.slug === ws)
if (!workspace) throw new Error(`no workspace ${ws}`)
// In use here: asked who they are (the listing names tokens by id, never by value).
const inUse = new Set()
const siblings = dirname(fileURLToPath(new URL('..', import.meta.url)))
const lanes = [...readdirSync(siblings).map((d) => read(join(siblings, d, '.e2e-lane-tokens.json'))), read(process.env.STUDIO_LANE_TOKENS_FILE || join(homedir(), '.cache', 'barkpark-studio', 'lane-tokens.json'))]
const values = [...lanes.flatMap((f) => Object.values(f).flatMap((pair) => Object.values(pair ?? {}))), ...Object.values(readDevTokens()), process.env.BARKPARK_TOKEN, process.env.BARKPARK_ADMIN_TOKEN, process.env.BARKPARK_APP_TOKEN]
for (const token of new Set(values.filter(Boolean))) {
  const self = await json('/v1/auth/token', {authorization: `Bearer ${token}`}).catch(() => null)
  if (self?.id) inUse.add(self.id)
}

const cutoff = Date.now() - days * 86_400_000
const stale = (await json('/v1/auth/app-tokens')).tokens
  .filter((t) => t.workspace_id === workspace.id && !t.revoked_at && prefixes.some((p) => t.label?.startsWith(p)) && Date.parse(t.inserted_at) < cutoff && !inUse.has(t.id))
  .sort((a, b) => a.inserted_at.localeCompare(b.inserted_at))

const members = []
for (let offset = 0; ; ) {
  const page = await json(`/w/${ws}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/members?limit=200&offset=${offset}`)
  members.push(...page.members)
  if (!page.hasMore || page.nextOffset === undefined || page.nextOffset <= offset) break
  offset = page.nextOffset
}
const count = (f) => members.filter(f).length
console.log(`${ws}: ${members.length} members: ${count((m) => m.principal_type === 'user')} people, ${count((m) => m.principal_type !== 'user' && !m.revoked)} live tokens, ${count((m) => m.principal_type !== 'user' && m.revoked)} revoked tokens (rows Barkpark keeps)`)
console.log(`${stale.length} stale minted token(s), older than ${days} day(s), labels ${prefixes.join(' ')}; ${inUse.size} in use here, left out:`)
for (const t of stale) console.log(`  ${t.inserted_at.slice(0, 16)}  ${t.id}  ${t.label}  [${t.permissions.join(',')}]${t.dataset ? `  ${t.dataset}` : ''}`)
if (!process.argv.includes('--yes')) {
  if (stale.length) console.log('Nothing revoked (dry run). With the owner\'s approval of this list: --yes')
  process.exit(0)
}
let revoked = 0
for (const t of stale) {
  for (let i = 0; i < 8; i++) {
    const res = await fetch(`${url}/v1/auth/app-tokens/${t.id}`, {method: 'DELETE', headers})
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, Math.min(Number(res.headers.get('retry-after')) || 2, 30) * 1000))
      continue
    }
    if (res.ok) revoked++
    break
  }
}
console.log(`revoked ${revoked} of ${stale.length}`)
