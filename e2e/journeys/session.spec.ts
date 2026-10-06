import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// task-ccd1876176b0fc08 / J48 evidence, ours with dev sign-in (STUDIO_DEV_LOGIN=1 +
// BARKPARK_ADMIN_TOKEN, dev server): (1) the session is lost mid-edit (cookie gone,
// as after a studio restart or expiry) → writes stop (nothing lands as the shared
// studio token), the footer says "You've been logged out" with Sign in; signing in
// again sends the edits typed meanwhile, as that editor. (2) A write Barkpark
// refuses (403) says why and does not retry on its own. Studio editor c holds a
// read-only token the studio can't see is read-only (labelled outside its app:
// tokens), so the form stays open and the write is refused — the case J49's lock
// can't catch. Not a CI gate.
const ID = 'post-19'
const EXCERPT = 'Short excerpt for post 19.'
const shot = (step: string) => `evidence/J48-studio-${step}.png`
test.use({video: 'on'})
test.setTimeout(120_000)

test.afterEach(async ({}, info) => target(info).restore(ID, {excerpt: EXCERPT}))

const base = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/data`
const lastAuthor = async () => {
  const r = await fetch(`${base()}/history/${process.env.BARKPARK_DATASET}/post/${ID}?limit=1`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  const {revisions} = (await r.json()) as {revisions: {actor_id?: string}[]}
  return revisions[0]?.actor_id
}

test('@evidence J48: session lost mid-edit fails closed; signing in again saves as you; a 403 says why', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity' || process.env.STUDIO_DEV_LOGIN !== '1', 'ours, with dev sign-in')
  const note = (what: string, v: unknown) => info.annotations.push({type: what, description: JSON.stringify(v)})
  const footer = page.locator('.doc-footer')
  await t.prepare(context)

  // Signed in as editor A, an edit saves as A.
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page, 'studio-editor-a@example.com')
  await t.settle(page)
  const excerpt = t.field(page, 'excerpt')
  await excerpt.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' A1')
  await expect.poll(() => t.docValue(ID, 'excerpt'), {timeout: 10_000}).toBe(`${EXCERPT} A1`)
  const editorA = await lastAuthor()
  note('author while signed in', editorA)

  // The session goes (cookie dropped). More typing: nothing is written, the footer says so.
  await context.clearCookies()
  await page.keyboard.type(' A2 while logged out')
  await expect(footer).toContainText("You've been logged out — not saving. Sign in to save your edits.", {timeout: 10_000})
  await expect(page.getByRole('alert').filter({hasText: "You've been logged out. Your edits are kept here"})).toBeVisible()
  await page.waitForTimeout(3000)
  expect(await t.docValue(ID, 'excerpt'), 'nothing saved as the studio').toBe(`${EXCERPT} A1`)
  await page.screenshot({path: shot('1-logged-out')})

  // Sign in again, right there: the waiting edit goes out, as editor A.
  await footer.getByRole('button', {name: 'Sign in'}).click()
  const dialog = page.getByRole('dialog', {name: "You've been logged out"})
  await dialog.locator('#sign-in-again-email').fill('studio-editor-a@example.com')
  await dialog.getByRole('button', {name: 'Sign in'}).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => t.docValue(ID, 'excerpt'), {timeout: 15_000}).toBe(`${EXCERPT} A1 A2 while logged out`)
  expect(await lastAuthor(), 'saved as editor A, not the studio').toBe(editorA)
  await page.screenshot({path: shot('2-signed-in-again')})

  // A write Barkpark refuses (the studio didn't know): a reason, and no retry.
  await context.clearCookies()
  await page.goto(t.docPath('post', ID)) // no session: the studio asks who you are
  await signInIfAsked(page, 'studio-editor-c@example.com')
  await t.settle(page)
  const writes: string[] = []
  page.on('request', (r) => r.method() === 'POST' && (r.postData() ?? '').includes('mutations') && writes.push(r.url()))
  await t.field(page, 'excerpt').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' C')
  await expect(footer).toContainText('Not saved:', {timeout: 10_000})
  note('refused footer', await footer.locator('.save-state').innerText())
  await page.waitForTimeout(1500) // a keystroke still queued behind the refused write tries once
  const n = writes.length
  await page.waitForTimeout(5000)
  expect(writes.length, 'no retry on its own').toBe(n)
  await page.screenshot({path: shot('3-refused')})
})

// The reference: Sanity with its session token taken away mid-edit (localStorage
// and cookies cleared, as an expired login). What it shows goes to the annotations.
test('@evidence J48 reference: Sanity loses its session mid-edit', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'sanity', 'the reference')
  await t.prepare(context)
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await t.field(page, 'excerpt').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' S1')
  await page.waitForTimeout(3000)
  await page.evaluate(() => localStorage.clear())
  await context.clearCookies()
  await page.keyboard.type(' S2 after logout')
  await page.waitForTimeout(6000)
  await page.screenshot({path: 'evidence/J48-sanity-1-logged-out.png'})
  info.annotations.push({type: 'sanity shows', description: JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role=dialog], [role=alert], [data-ui=Toast]')].map((e) => (e.textContent ?? '').trim().slice(0, 200)).filter(Boolean)))})
  info.annotations.push({type: 'sanity saved', description: JSON.stringify(await t.docValue(ID, 'excerpt'))})
})
