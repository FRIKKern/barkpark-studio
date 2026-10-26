// @local: STUDIO_SIGN_IN=sso against the built app, not live SSO evidence.
// Build app first, then: node e2e/sso-contract.mjs
// Uses only loopback servers and synthetic settings.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {fileURLToPath} from 'node:url'
import {chromium, expect} from '@playwright/test'

const port = Number(process.env.SSO_CONTRACT_PORT || 3015)
const origin = `http://127.0.0.1:${port}`

/** A preview of the built app with STUDIO_SIGN_IN=sso and `extra` settings; `run` gets its log. */
async function withStudio(extra, run) {
  const env = {...process.env, BARKPARK_URL: 'http://127.0.0.1:9', BARKPARK_WORKSPACE: 'contract', STUDIO_SIGN_IN: 'sso', STUDIO_LOCALE: 'en-US', STUDIO_SESSION_SECRET: randomBytes(32).toString('base64'), ...extra}
  // Empty process values also override Vite's optional .env loading.
  for (const key of ['BARKPARK_TOKEN', 'BARKPARK_CLOUD_URL', 'BARKPARK_CLOUD_INSTANCE', 'STUDIO_DEV_LOGIN']) env[key] = extra[key] ?? ''
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

await withStudio({BARKPARK_CLOUD_INSTANCE: 'synthetic-instance'}, async (log) => {
  assert.equal((await fetch(`${origin}/login`)).status, 500)
  assert.match(log(), /STUDIO_SIGN_IN=sso refuses BARKPARK_CLOUD_INSTANCE/)
  console.log('PASS sso refuses a Barkpark Cloud setting, naming it')
})

const browser = await chromium.launch()
try {
  await withStudio({}, async () => {
    const page = await browser.newPage()
    await page.goto(`${origin}/login`)
    await expect(page.getByRole('heading', {name: 'Barkpark Studio'})).toBeVisible()
    await expect(page.getByLabel('Password', {exact: true})).toHaveCount(0)
    await expect(page.getByRole('button', {name: 'Forgot password?'})).toHaveCount(0)
    console.log('PASS sso sign-in page has no password field and no reset link')
  })
} finally {
  await browser.close()
}
