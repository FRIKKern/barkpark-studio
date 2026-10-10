#!/usr/bin/env node
// A read-only editor for the dev sign-in evidence specs (J48 session.spec, J49 read-only.spec):
//   node --env-file=.env scripts/rig-editor-tokens.mjs e2e-<lane>   # the lane is its dataset
// studio-editor-d gets a read-only app:… token (the studio reads its permissions,
// GET /v1/auth/token, and locks the form: J49; J48 borrows its session for a 403).
// Earlier runs' editor-c (rig:) tokens are revoked too. It goes into the shared dev-token
// store (scripts/lib/dev-tokens.mjs), where dev sign-in reuses it. Minted with the .env token (it
// must administer the workspace). --revoke revokes them and forgets them.
import {editorPermissions, keepDevToken} from './lib/dev-tokens.mjs'

const lane = process.argv[2]
if (!lane || !/^(?:e2e-[a-z0-9-]+|ci(?:-2)?)$/.test(lane)) throw new Error('usage: rig-editor-tokens.mjs <e2e-… dataset> [--revoke]')
// Dev sign-in reuses editor d's token from the shared store (scripts/lib/dev-tokens.mjs).
const saved = {tokens: {}}
const url = process.env.BARKPARK_URL
const admin = {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`, 'content-type': 'application/json'}
const editors = {'studio-editor-c@example.com': 'rig', 'studio-editor-d@example.com': 'app'}
const minted = new Set(['studio-editor-d@example.com'])

const list = await fetch(`${url}/v1/auth/app-tokens`, {headers: admin})
if (!list.ok) throw new Error(`listing app tokens: ${list.status} (the .env token must administer ${process.env.BARKPARK_WORKSPACE})`)
const live = ((await list.json()).tokens ?? []).filter((t) => !t.revoked_at)
for (const [email, kind] of Object.entries(editors)) {
  // Earlier read-only tokens of this editor (and, for d, any app: token: the studio must see read-only).
  for (const t of live.filter((t) => t.label === `${kind}:${email}` && (kind === 'app' || t.permissions.join() === 'read')))
    await fetch(`${url}/v1/auth/app-tokens/${t.id}`, {method: 'DELETE', headers: admin})
  delete saved.tokens[email]
  if (process.argv.includes('--revoke') || !minted.has(email)) continue
  const res = await fetch(`${url}/v1/auth/app-tokens`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({email, workspace: process.env.BARKPARK_WORKSPACE, permissions: editorPermissions(email), label: `${kind}:${email}`, dataset: lane}),
  })
  if (!res.ok) throw new Error(`minting for ${email}: ${res.status} ${await res.text()}`)
  const {token} = await res.json()
  saved.tokens[email] = token
}
for (const email of Object.keys(editors)) keepDevToken(process.env.BARKPARK_WORKSPACE, email, saved.tokens[email])
console.log(process.argv.includes('--revoke') ? `${lane}: editor d's tokens revoked` : `${lane}: editor d (app:, read-only) ready for dev sign-in`)
