// Global setup: request every route once so the dev server has compiled them, and
// the server has made its first Barkpark round trips, before any timing is taken
// (a cold compile or cold connection is not what F2/F3 measure). In parallel: in CI
// each request crosses to a far-away Barkpark, and the suite has a 60 s budget.
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {devToken} from '../../scripts/lib/dev-tokens.mjs'
import {clearFeelLog} from './feel-summary'

/**
 * Dev sign-in runs (J48, J49, J63) need studio-editor-d to be read-only. The shared
 * dev-token store can hold a full token for them (a dev sign-in after their read-only
 * token was revoked mints one), and J63 then "saw another editor's draft", only because
 * editor d could write (task-c9877a98acaaf8e4). Re-mint the read-only token whenever
 * the stored one is missing or not read-only.
 */
async function readOnlyEditorD() {
  const url = process.env.BARKPARK_URL
  const dataset = process.env.BARKPARK_DATASET
  if (process.env.STUDIO_DEV_LOGIN !== '1' || !url || !dataset) return
  const token = devToken(process.env.BARKPARK_WORKSPACE, 'studio-editor-d@example.com')
  const self = token ? ((await (await fetch(`${url}/v1/auth/token`, {headers: {authorization: `Bearer ${token}`}})).json().catch(() => ({}))) as {permissions?: string[]; dataset?: string}) : {}
  if (self.permissions?.join() === 'read' && (!self.dataset || self.dataset === dataset)) return
  const admin = process.env.BARKPARK_ADMIN_TOKEN || process.env.BARKPARK_SERVICE_TOKEN || process.env.BARKPARK_TOKEN
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/rig-editor-tokens.mjs', import.meta.url)), dataset], {env: {...process.env, BARKPARK_TOKEN: admin}, encoding: 'utf8'})
  if (r.status !== 0) throw new Error(`editor d is not read-only, and re-minting failed: ${r.stderr || r.stdout}`)
}

export default async function warmup() {
  clearFeelLog()
  await readOnlyEditorD()
  const base = `http://localhost:${process.env.E2E_PORT || 3100}`
  await fetch(`${base}/health`).then((r) => r.text())
  await Promise.all(
    ['/structure', '/structure/post', '/structure/post;post-01;author-alan,type=author,parentRefPath=author'].map((path) => fetch(base + path).then((r) => r.text())),
  )
}
