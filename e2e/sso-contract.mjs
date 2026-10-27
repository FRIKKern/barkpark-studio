// @local: STUDIO_SIGN_IN=sso against the built app, not live SSO evidence.
// Build app first, then: node e2e/sso-contract.mjs
// Uses only loopback servers and synthetic settings. The backend plays Barkpark's OIDC
// routes (api OidcController) and an identity provider that signs the editor in at once.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash, randomBytes} from 'node:crypto'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {fileURLToPath} from 'node:url'
import {chromium, expect} from '@playwright/test'

const port = Number(process.env.SSO_CONTRACT_PORT || 3015)
const origin = `http://127.0.0.1:${port}`
const scope = '/w/contract/p/default'
const pagePath = `${scope}/d/review/structure`
const person = 'synthetic-sso-session'
const pending = new Map()
const tickets = new Map()
const exchanges = []
let ticketAudience // unset: the origin of return_to, as Barkpark binds it
const backend = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  const reply = (status, body) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(body))}
  const go = (location) => {res.writeHead(302, {location}); res.end()}
  if (path === '/v1/auth/oidc/contract-org/start') {
    const idpState = randomBytes(8).toString('hex')
    pending.set(idpState, Object.fromEntries(url.searchParams))
    return go(`/idp/authorize?state=${idpState}`)
  }
  if (path === '/idp/authorize') return go(`/v1/auth/oidc/contract-org/callback?code=c&state=${url.searchParams.get('state')}`)
  if (path === '/v1/auth/oidc/contract-org/callback') {
    const studio = pending.get(url.searchParams.get('state'))
    const ticket = `bplt_${randomBytes(8).toString('hex')}`
    tickets.set(ticket, {audience: ticketAudience ?? new URL(studio.return_to).origin, challenge: studio.code_challenge})
    return go(`${studio.return_to}?${new URLSearchParams({ticket, state: studio.state})}`)
  }
  if (path === '/v1/auth/sso/exchange' && req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    exchanges.push(body)
    const bound = tickets.get(body.ticket)
    tickets.delete(body.ticket)
    const ok = bound && bound.audience === body.audience && bound.challenge === createHash('sha256').update(body.code_verifier).digest('base64url')
    return ok ? reply(201, {token: person, user: {id: 'person-id', email: 'editor@example.invalid'}}) : reply(401, {error: {code: 'invalid_ticket'}})
  }
  if (token !== person) return reply(401, {error: {code: 'invalid_token'}})
  if (path === '/v1/auth/token') return reply(200, {kind: 'session', user: {id: 'person-id'}, seats: [{workspace: {slug: 'contract'}, role: 'member', can: {read: true, write: true, publish: true, admin: false}}]})
  if (path === '/v1/auth/me') return reply(200, {user: {display_name: 'SSO editor'}})
  if (path === `${scope}/v1/schemas/review`) return reply(200, {schemas: [{name: 'reviewCandidate', title: 'Review candidates', fields: [{name: 'title', type: 'string'}]}]})
  if (path === `${scope}/v1/data/doc/review/deskStructure/deskStructure`) return reply(404, {})
  if (path === `${scope}/v1/data/query/review`) return reply(200, {result: {documents: [], hasMore: false}})
  return reply(403, {error: {code: 'fixture_does_not_grant_access'}})
})
await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve))

/** A preview of the built app with STUDIO_SIGN_IN=sso and `extra` settings; `run` gets its log. */
async function withStudio(extra, run) {
  const env = {...process.env, BARKPARK_URL: `http://127.0.0.1:${backend.address().port}`, BARKPARK_WORKSPACE: 'contract', BARKPARK_PROJECT: 'default', BARKPARK_DATASET: 'review', STUDIO_SIGN_IN: 'sso', STUDIO_SSO_ORG: 'contract-org', STUDIO_LOCALE: 'en-US', STUDIO_SESSION_SECRET: randomBytes(32).toString('base64'), ...extra}
  // Empty process values also override Vite's optional .env loading.
  for (const key of ['BARKPARK_TOKEN', 'BARKPARK_SERVICE_TOKEN', 'BARKPARK_CLOUD_URL', 'BARKPARK_CLOUD_INSTANCE', 'STUDIO_DEV_LOGIN', 'BARKPARK_SCHEMA_SOURCE']) env[key] = extra[key] ?? ''
  const app = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {cwd: fileURLToPath(new URL('../app', import.meta.url)), env, stdio: 'pipe', detached: true})
  let log = ''
  app.stdout.on('data', (data) => {log += data})
  app.stderr.on('data', (data) => {log += data})
  try {
    await expect.poll(() => fetch(`${origin}/health`).then(() => true, () => false), {timeout: 20_000}).toBe(true)
    await run(() => log)
  } catch (error) {
    console.error(log.slice(-3000))
    throw error
  } finally {
    const ended = once(app, 'exit')
    if (app.exitCode === null) process.kill(-app.pid, 'SIGTERM')
    if (app.exitCode === null) await ended
  }
}

const browser = await chromium.launch()
try {
  await withStudio({BARKPARK_CLOUD_INSTANCE: 'synthetic-instance'}, async (log) => {
    assert.equal((await fetch(`${origin}/login`)).status, 500)
    assert.match(log(), /STUDIO_SIGN_IN=sso refuses BARKPARK_CLOUD_INSTANCE/)
    console.log('PASS sso refuses a Barkpark Cloud setting, naming it')
  })

  await withStudio({}, async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(origin + pagePath)
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await expect(page.getByLabel('Password', {exact: true})).toHaveCount(0)
    await expect(page.getByRole('button', {name: 'Forgot password?'})).toHaveCount(0)
    console.log('PASS sso sign-in page has no password field and no reset link')

    await page.getByRole('link', {name: 'Sign in with single sign-on'}).click()
    await expect(page).toHaveURL(origin + pagePath)
    await expect(page.getByText('Review candidates', {exact: true}).first()).toBeVisible()
    assert.equal(exchanges.at(-1).audience, origin, 'the ticket is traded for this studio origin')
    assert.equal((await context.cookies()).filter((c) => c.name === 'bp_sid').length, 1)
    console.log('PASS sso signs the editor in through the identity provider and the ticket exchange')
    await context.close()

    // A ticket bound to another origin: Barkpark refuses the exchange, so no session here.
    ticketAudience = 'http://elsewhere.invalid'
    const other = await browser.newContext()
    const again = await other.newPage()
    await again.goto(`${origin}/login`)
    await again.getByRole('link', {name: 'Sign in with single sign-on'}).click()
    await expect(again).toHaveURL(/\/login\?cloud_error=ticket/)
    await expect(again.getByRole('alert')).toHaveText('Single sign-on could not sign you in. Try again.')
    assert.equal((await other.cookies()).filter((c) => c.name === 'bp_sid').length, 0)
    console.log('PASS a ticket for another audience is refused and no session is made')
    await other.close()
  })
} finally {
  await browser.close()
  backend.closeAllConnections()
  await new Promise((resolve) => backend.close(resolve))
}
