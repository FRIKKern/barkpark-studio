import {spawn} from 'node:child_process'
import {expect, test} from '@playwright/test'
import {bpMutate, target} from '../rig/targets'

// J67, ours: a production build asks for a Barkpark account, the editor works as
// themselves, and Sign out ends it. Runs only when the studio is started with
// STUDIO_SIGN_IN=account and an account is in .env (the owner's test account:
// LIVEVIEW_TEST_EMAIL / _PASSWORD, a member of studio-parity), so @local. It never prints
// the password. Its edit goes to the lane's post-01 draft and is discarded after.
const EMAIL = process.env.LIVEVIEW_TEST_EMAIL
const PASSWORD = process.env.LIVEVIEW_TEST_PASSWORD
test.skip(process.env.STUDIO_SIGN_IN !== 'account' || !EMAIL || !PASSWORD, 'needs STUDIO_SIGN_IN=account and an account in .env')

test('@local J67: sign in with a Barkpark account, work as yourself, sign out', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours')
  // Signed out, the studio sends you to sign in, and nothing reads as the studio meanwhile.
  await page.goto(t.docPath('post', 'post-01'))
  await page.waitForURL(/\/login\?redirect=/)
  await page.locator('html[data-hydrated]').waitFor({state: 'attached'})
  const data = await page.request.get('/structure/post').then((r) => r.text())
  expect(data, 'a signed-out page carries no documents').not.toContain('Fixture post 01')

  // A wrong password says so and keeps you here.
  await page.getByLabel('Your email').fill(EMAIL!)
  await page.getByLabel('Password').fill('not-the-password')
  await page.getByRole('button', {name: 'Sign in'}).click()
  await expect(page.getByRole('alert')).toHaveText('The email or password is incorrect.')
  await expect(page.getByLabel('Password')).toHaveValue('')

  // The right one: back where you were going, as yourself.
  await page.getByLabel('Password').fill(PASSWORD!)
  await page.getByRole('button', {name: 'Sign in'}).click()
  await page.waitForURL(/\/structure\/post;post-01/)
  await t.settle(page)
  await expect(t.field(page, 'title')).toHaveValue('Fixture post 01')
  // A member writes (Barkpark's member seat, described at /v1/auth/token since #22783):
  // no Viewer banner, the bulk ticks show (B03), an edit saves, and history names them.
  await expect(page.getByText('Your role Viewer does not have permission to edit this document.')).toHaveCount(0)
  await expect(page.getByRole('checkbox', {name: /^Select Fixture post/}).first()).toBeVisible()
  try {
    await t.field(page, 'excerpt').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' J67')
    await expect(page.locator('.doc-footer')).toContainText('Saved', {timeout: 10_000})
    const last = async () => {
      const r = await fetch(`${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/data/history/${process.env.BARKPARK_DATASET}/post/post-01?limit=1`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
      const rev = ((await r.json()) as {revisions: {actor_kind?: string; actor_label?: string}[]}).revisions[0]
      return `${rev?.actor_kind} ${rev?.actor_label}`
    }
    await expect.poll(last, {timeout: 10_000}).toBe(`user ${EMAIL!.toLowerCase()}`)
  } finally {
    await bpMutate([{discardDraft: {id: 'post-01', type: 'post'}}]).catch(() => {})
  }

  // task-1883ba9b1ace5dcf: a restart or a deploy keeps you signed in. A second studio server
  // with the same STUDIO_SESSION_SECRET and nothing of the first in memory opens the same
  // cookie (cookies ignore the port). Production build only: it serves the built app.
  if (process.env.STUDIO_SESSION_SECRET && process.env.E2E_PROD) {
    const port = Number(process.env.E2E_PORT || 3100) + 50
    const env = {...process.env, STUDIO_SIGN_IN: 'account', ...(process.env.BARKPARK_APP_TOKEN && {BARKPARK_TOKEN: process.env.BARKPARK_APP_TOKEN})}
    const other = spawn('pnpm', ['--dir', '../app', 'exec', 'vite', 'preview', '--port', String(port), '--strictPort'], {env, stdio: 'ignore', detached: true})
    try {
      await expect.poll(() => fetch(`http://localhost:${port}/health`).then((r) => r.ok, () => false), {timeout: 30_000}).toBe(true)
      await page.goto(`http://localhost:${port}${t.docPath('post', 'post-01')}`)
      await expect(t.field(page, 'title')).toHaveValue('Fixture post 01')
    } finally {
      process.kill(-other.pid!)
    }
    await page.goto(t.docPath('post', 'post-01'))
    await t.settle(page)
  }
  await page.getByRole('button', {name: 'Open user menu'}).click()
  await expect(page.locator('.user-head')).toHaveText(EMAIL!.toLowerCase())
  await page.screenshot({path: 'evidence/J67-1-signed-in-studio.png'})

  // Sign out: back to the sign-in screen, and the studio no longer opens.
  await page.getByRole('menuitem', {name: 'Sign out'}).click()
  await page.waitForURL(/\/login/)
  await page.goto(t.docPath('post', 'post-01'))
  await page.waitForURL(/\/login\?redirect=/)
})
