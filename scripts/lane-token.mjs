#!/usr/bin/env node
// Member tokens per local e2e lane, so lanes don't share one rate-limit bucket
// (Barkpark meters each token: 60 writes, 300 reads a minute):
//   node --env-file=.env scripts/lane-token.mjs e2e-freeform   # the lane is its dataset
// Two per lane: `app` for the studio server, `rig` for the specs' own reads and writes.
// A token minted with a `dataset` is bound to it (Barkpark, 2026-10-09): `rig` is (the
// specs touch only the lane), `app` is not (the studio switches datasets, B02).
// Reused while they work, else the lane's old ones (label lane:<dataset>[:rig]) are
// revoked and new ones minted with the .env token (it must administer the workspace).
// Kept in the gitignored .e2e-lane-tokens.json; e2e/run.mjs picks them up by dataset.
// Also kept for the whole machine (~/.cache/barkpark-studio/lane-tokens.json), so a new
// worktree reuses the lane's tokens instead of minting: every mint leaves a member row
// in the workspace for good, revoked or not (task-0b926def1700437e).
// --revoke revokes the lane's tokens and forgets them.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join} from 'node:path'

const lane = process.argv[2]
if (!lane || !/^(?:e2e-[a-z0-9-]+)$/.test(lane)) throw new Error('usage: lane-token.mjs <e2e-… dataset> [--revoke]')
const file = new URL('../.e2e-lane-tokens.json', import.meta.url)
const read = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} } }
const tokens = read(file)
const url = process.env.BARKPARK_URL
const ws = process.env.BARKPARK_WORKSPACE
const machineFile = process.env.STUDIO_LANE_TOKENS_FILE || join(homedir(), '.cache', 'barkpark-studio', 'lane-tokens.json')
const machine = read(machineFile)
const machineKey = `${url}|${ws}|${lane}`
const keep = (pair) => {
  mkdirSync(dirname(machineFile), {recursive: true})
  const next = {...read(machineFile), [machineKey]: pair}
  if (!pair) delete next[machineKey]
  writeFileSync(machineFile, JSON.stringify(next, null, 2), {mode: 0o600})
}
const scope = `${url}/w/${ws}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const admin = {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`, 'content-type': 'application/json'}
const labels = {app: `lane:${lane}`, rig: `lane:${lane}:rig`}
const works = (t) => t && fetch(`${scope}/v1/data/query/${lane}/post?limit=1`, {headers: {authorization: `Bearer ${t}`}}).then((r) => r.ok)
if (!process.argv.includes('--revoke'))
  for (const [where, pair] of [['this worktree', tokens[lane]], ['this machine', machine[machineKey]]])
    if ((await works(pair?.app)) && (await works(pair?.rig))) {
      tokens[lane] = pair
      writeFileSync(file, JSON.stringify(tokens, null, 2))
      keep(pair)
      console.log(`${lane}: tokens still good (from ${where})`)
      process.exit(0)
    }
const list = await fetch(`${url}/v1/auth/app-tokens`, {headers: admin})
if (!list.ok) throw new Error(`listing app tokens: ${list.status} (the .env token must administer ${ws})`)
let revoked = 0
for (const t of (await list.json()).tokens ?? [])
  if (Object.values(labels).includes(t.label) && !t.revoked_at) revoked += (await fetch(`${url}/v1/auth/app-tokens/${t.id}`, {method: 'DELETE', headers: admin})).ok ? 1 : 0
delete tokens[lane]
if (!process.argv.includes('--revoke')) {
  tokens[lane] = {}
  for (const [use, label] of Object.entries(labels)) {
    const res = await fetch(`${url}/v1/auth/app-tokens`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({email: `${lane}@lanes.example.com`, workspace: ws, permissions: ['read', 'write'], label, ...(use === 'rig' && {dataset: lane})}),
    })
    if (!res.ok) throw new Error(`minting ${label}: ${res.status} ${await res.text()}`)
    tokens[lane][use] = (await res.json()).token
  }
}
writeFileSync(file, JSON.stringify(tokens, null, 2))
keep(tokens[lane])
console.log(`${lane}: revoked ${revoked}${tokens[lane] ? ', minted 2' : ''}`)
