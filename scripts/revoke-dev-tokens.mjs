#!/usr/bin/env node
// Revoke every per-editor token the dev sign-in minted (app/src/server/auth.ts) and
// forget them: node --env-file=.env scripts/revoke-dev-tokens.mjs
import {readFileSync, rmSync} from 'node:fs'
const file = new URL('../.studio-dev-tokens.json', import.meta.url)
const {workspaceId, tokens = {}} = JSON.parse((() => { try { return readFileSync(file, 'utf8') } catch { return '{}' } })())
const h = {authorization: `Bearer ${process.env.BARKPARK_ADMIN_TOKEN}`}
let n = 0
for (const email of Object.keys(tokens)) {
  const r = await fetch(`${process.env.BARKPARK_URL}/v1/auth/app-tokens?email=${encodeURIComponent(email)}`, {headers: h}).then((r) => r.json())
  for (const t of r.tokens ?? [])
    if (!t.revoked_at && t.label === `app:${email}` && t.workspace_id === workspaceId && !t.permissions.includes('chat'))
      n += (await fetch(`${process.env.BARKPARK_URL}/v1/auth/app-tokens/${t.id}`, {method: 'DELETE', headers: h})).ok ? 1 : 0
}
rmSync(file, {force: true})
console.log(`revoked ${n} dev editor token(s)`)
