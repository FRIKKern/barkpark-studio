import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J37, the navbar shell: tools (Structure, Vision) and the user menu. Evidence
// stills on both studios to e2e/evidence/.
const shot = (name: string, step: string) => `evidence/J37-${name}-${step}.png`

test('@evidence J37: navbar, user menu, Vision side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  await page.waitForTimeout(1000)
  await page.screenshot({path: shot(t.name, '1-navbar')})
  await page.locator('#user-menu').click() // both studios
  await page.waitForTimeout(500)
  await page.screenshot({path: shot(t.name, '2-user-menu')})
  await page.keyboard.press('Escape')
  await page.getByRole('link', {name: 'Vision'}).first().click()
  await page.waitForTimeout(2500)
  await page.screenshot({path: shot(t.name, '3-vision')})
})

test('@local J37: tool switcher, Vision query, user menu', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  const tool = (name: string) => page.getByRole('navigation').getByRole('link', {name})
  await expect(tool('Structure')).toHaveAttribute('aria-current', 'page')

  await tool('Vision').click()
  await expect(page).toHaveURL(/\/vision$/)
  await expect(tool('Vision')).toHaveAttribute('aria-current', 'page')
  const query = page.getByLabel('Query')
  await query.fill('post?filter[title][contains]=post 12&limit=5')
  await query.press('ControlOrMeta+Enter')
  await expect(page.getByRole('region', {name: 'Result'})).toContainText('"Fixture post 12"')
  await expect(page.getByText(/^Execution: \d+ ms$/)).toBeVisible()
  // Anything but a type and a query string never reaches Barkpark.
  await query.fill('../../v1/tasks')
  await page.getByRole('button', {name: 'Fetch'}).click()
  await expect(page.getByRole('alert')).toContainText('A query is a type')

  // The user menu: appearance as radios with icons (J45 checks the switching).
  await page.locator('#user-menu').click()
  await expect(page.getByRole('menuitemradio', {name: 'Use system appearance'})).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await tool('Structure').click()
  await expect(page).toHaveURL(/\/structure$/)
})

test('@local J53: a newer build on the server shows the update dot and "Reload to update"', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'a local Sanity Studio has no auto-updates to announce')
  await t.prepare(context)
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  const help = page.getByRole('button', {name: 'Help and resources'})
  await help.click()
  await expect(page.getByRole('menuitem', {name: /Barkpark Studio\s*Up to date/})).toBeVisible()
  await page.keyboard.press('Escape')
  // A redeploy: the server now answers another build.
  await page.route('**/api/version', (route) => route.fulfill({json: {build: 'abc1234-next'}}))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(help).toHaveAttribute('title', 'New version available')
  await help.click()
  await expect(page.getByRole('menuitem', {name: /Reload to update to abc1234/})).toBeEnabled()
})
