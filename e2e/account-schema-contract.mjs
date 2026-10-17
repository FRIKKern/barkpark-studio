// @local: built-app credential contract, not live account or release evidence.
// Build app first, then: node e2e/account-schema-contract.mjs
// Uses only a loopback fixture server and synthetic credentials.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {fileURLToPath} from 'node:url'
import {chromium, expect} from '@playwright/test'

const port = Number(process.env.ACCOUNT_CONTRACT_PORT || 3014)
const origin = `http://127.0.0.1:${port}`
const scope = '/w/contract/p/default'
const pagePath = `${scope}/d/review/structure`
const person = 'synthetic-person-session'
const service = 'synthetic-service-token'
const reads = []
let declared = false
let revoked = false
let structureRefused = false
const backend = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  reads.push({path, token, method: req.method})
  const reply = (status, body) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(body))}
  if (path === '/v1/auth/login' && req.method === 'POST') return reply(201, {token: person, user: {email: 'editor@example.invalid'}})
  if (token === person && revoked) return reply(401, {error: {code: 'invalid_token'}})
  if (path === '/v1/auth/token' && token === person) return reply(200, {kind: 'session', user: {id: 'person-id'}, expires_at: null, seats: [{workspace: {id: 'workspace-id', slug: 'contract'}, role: 'member', can: {read: true, write: true, publish: true, admin: false}}]})
  if (path === '/v1/auth/me' && token === person) return reply(200, {user: {display_name: 'Contract editor'}})
  if (path === `${scope}/v1/schemas/review`) return token === person
    ? reply(200, {schemas: [{name: 'reviewCandidate', title: 'Review candidates', fields: [{name: 'title', type: 'string'}]}]})
    : reply(403, {error: {code: 'wrong_schema_identity'}})
  if (path === `${scope}/v1/data/doc/review/deskStructure/deskStructure` && token === person) return declared ? reply(200, {result: {title: 'Review desk'}}) : reply(404, {})
  if (path === `${scope}/v1/structure/review` && structureRefused) return reply(401, {error: {code: 'invalid_token'}})
  if (path === `${scope}/v1/structure/review`) return token === service
    ? reply(200, {structure: {id: 'root', type: 'list', title: 'Structure', items: [{id: 'candidates', type: 'document_type_list', typeName: 'reviewCandidate', title: 'Declared candidates'}]}})
    : reply(403, {error: {code: 'admin_required'}})
  if (path === `${scope}/v1/data/query/review` && token === person) return reply(200, {result: {documents: [], hasMore: false}})
  return reply(403, {error: {code: 'fixture_does_not_grant_access'}})
})
await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch()
try {
  for (const hasDesk of [false, true]) {
    declared = hasDesk
    revoked = false
    structureRefused = false
    reads.length = 0
    const env = {...process.env, BARKPARK_URL: `http://127.0.0.1:${backend.address().port}`, BARKPARK_WORKSPACE: 'contract', BARKPARK_PROJECT: 'default', BARKPARK_DATASET: 'review', STUDIO_SIGN_IN: 'account', STUDIO_LOCALE: 'en-US', STUDIO_SESSION_SECRET: randomBytes(32).toString('base64')}
    // Empty process values also override Vite's optional .env loading.
    for (const key of ['BARKPARK_TOKEN', 'BARKPARK_SERVICE_TOKEN', 'BARKPARK_ADMIN_TOKEN', 'STUDIO_DEV_LOGIN', 'BARKPARK_SCHEMA_SOURCE']) env[key] = ''
    if (hasDesk) env.BARKPARK_SERVICE_TOKEN = service
    const app = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {cwd: fileURLToPath(new URL('../app', import.meta.url)), env, stdio: 'pipe', detached: true})
    let log = ''
    app.stdout.on('data', (data) => {log += data})
    app.stderr.on('data', (data) => {log += data})
    const context = await browser.newContext()
    try {
      await expect.poll(async () => {
        assert.equal(app.exitCode, null, `Preview stopped: ${log}`)
        return fetch(`${origin}/health`).then((r) => r.ok, () => false)
      }, {timeout: 20_000}).toBe(true)
      const page = await context.newPage()
      await page.goto(origin + pagePath)
      await expect(page).toHaveURL(/\/login\?redirect=/)
      assert.equal(reads.filter((r) => r.path.includes('/v1/schemas/')).length, 0, 'signed-out page must not read schemas')
      await page.getByLabel('Your email').fill('editor@example.invalid')
      await page.getByLabel('Password', {exact: true}).fill('synthetic-password')
      await page.getByRole('button', {name: 'Sign in', exact: true}).click()
      await expect(page).toHaveURL(origin + pagePath)
      await expect(page.getByText(hasDesk ? 'Declared candidates' : 'Review candidates', {exact: true}).first()).toBeVisible()
      const schemaReads = reads.filter((r) => r.path.includes('/v1/schemas/'))
      assert.ok(schemaReads.length > 0, 'the production app must load API schemas')
      assert.ok(schemaReads.every((r) => r.token === person), 'schemas must always use the personal session')
      const deskReads = reads.filter((r) => r.path.includes('/v1/structure/'))
      if (hasDesk) assert.ok(deskReads.length > 0 && deskReads.every((r) => r.token === service), 'declared desk keeps its established guarded service path')
      else assert.equal(deskReads.length, 0, 'default navigation must work without a service credential')

      if (hasDesk) {
        structureRefused = true
        await new Promise((resolve) => setTimeout(resolve, 550))
        await page.reload()
        await expect(page.getByRole('heading', {name: "Barkpark refused this studio's token."})).toBeVisible()
        assert.equal((await context.cookies()).filter((cookie) => cookie.name === 'bp_sid').length, 1, 'refused service navigation must not end the personal session')
        structureRefused = false
      }

      // A backend refusal must remain a visible error, never a service-token retry.
      revoked = true
      reads.length = 0
      await new Promise((resolve) => setTimeout(resolve, 550)) // expire the existing 500 ms read coalescing window
      await page.reload()
      await expect(page.getByRole('heading', {name: "You've been logged out"})).toBeVisible()
      assert.ok(reads.some((r) => r.path.includes('/v1/schemas/') && r.token === person))
      assert.ok(reads.filter((r) => r.path.includes('/v1/schemas/')).every((r) => r.token === person))
      assert.equal(reads.filter((r) => r.path.includes('/v1/data/mutate/')).length, 0, 'read journey performs no content writes')
      await page.getByRole('link', {name: 'Sign in', exact: true}).click()
      await expect(page.getByLabel('Password', {exact: true})).toBeVisible()
      assert.equal((await context.cookies()).filter((cookie) => cookie.name === 'bp_sid').length, 0, 'the refused personal session is cleared')
      console.log(`PASS ${hasDesk ? 'declared desk preserves service navigation' : 'default navigation needs no shared token'}; schema session and revoked refusal`)
    } catch (error) {
      console.error(log.slice(-3000))
      throw error
    } finally {
      await context.close()
      const ended = once(app, 'exit')
      if (app.exitCode === null) process.kill(-app.pid, 'SIGTERM')
      if (app.exitCode === null) await ended
    }
  }
} finally {
  await browser.close()
  backend.closeAllConnections()
  await new Promise((resolve) => backend.close(resolve))
}
