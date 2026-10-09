import {expect, test, type BrowserContext, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target} from '../rig/targets'

// B11 widen (task-89fecb4915b2f30d): form edits Barkpark never acknowledged survive the
// tab dying. Saves are cut off (every mutate fails as a network error; a crash sends no
// unload beacon, so there is none), the excerpt is typed into, the tab is closed without
// asking; a new tab on the doc then sends them again (rev unchanged), or, when someone saved meanwhile, offers them
// (Restore merges the text). Ours only: Sanity keeps nothing in the browser. The
// replay and Discard run @local (CI's 60 s budget); the rules are unit-tested too.
const ID = 'post-29'
const EXCERPT = 'Short excerpt for post 29.'
test.setTimeout(90_000)

test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio') await target(info).restore(ID, {excerpt: EXCERPT})
})

async function typeThenCrash(context: BrowserContext, t: Target, text: string) {
  const page = await context.newPage()
  await page.addInitScript(() => (navigator.sendBeacon = () => true))
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.route('**/_serverFn/**', (route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? route.abort('failed') : route.continue()))
  await t.field(page, 'excerpt').click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
  await expect(page.locator('.doc-footer').first()).toContainText(/Offline|not saving/i)
  await page.waitForTimeout(500) // the browser store is written a moment after the last keystroke
  await page.close({runBeforeUnload: false})
}

async function reopen(context: BrowserContext, t: Target): Promise<Page> {
  const page = await context.newPage()
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  return page
}

test('kept form edits over a newer save are offered: Restore merges', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity keeps nothing in the browser')
  await t.prepare(context)
  await typeThenCrash(context, t, ' mine')
  await t.patch(ID, {excerpt: `Theirs. ${EXCERPT}`}, 'post')
  const page = await reopen(context, t)
  const card = page.getByTestId('kept-edits')
  await expect(card).toContainText('Unsaved changes from')
  await page.screenshot({path: 'evidence/B11-kept-edits-offer.png'})
  await card.getByRole('button', {name: 'Restore'}).click()
  await expect(card).toBeHidden()
  await expect.poll(() => t.docValue(ID, 'excerpt'), {timeout: 15_000}).toBe(`Theirs. ${EXCERPT} mine`)
})

test('@local kept form edits are sent again after a crash; Discard sticks', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity keeps nothing in the browser')
  await t.prepare(context)
  await typeThenCrash(context, t, ' kept')
  expect(await t.docValue(ID, 'excerpt')).toBe(EXCERPT)
  const page = await reopen(context, t)
  await expect(page.getByText(/Unsaved changes from .* were put back/)).toBeVisible()
  await expect.poll(() => t.docValue(ID, 'excerpt'), {timeout: 15_000}).toBe(`${EXCERPT} kept`)
  await page.close()
  // Discard leaves the server copy alone and the offer does not come back.
  await typeThenCrash(context, t, ' gone')
  await t.patch(ID, {excerpt: EXCERPT}, 'post')
  const again = await reopen(context, t)
  await again.getByTestId('kept-edits').getByRole('button', {name: 'Discard'}).click()
  await again.reload()
  await t.settle(again)
  await expect(again.getByTestId('kept-edits')).toHaveCount(0)
  expect(await t.docValue(ID, 'excerpt')).toBe(EXCERPT)
})
