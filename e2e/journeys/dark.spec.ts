import AxeBuilder from '@axe-core/playwright'
import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, closeAndSettle} from '../rig/targets'

// J45 evidence: dark mode. Both studios with the OS in dark (stills side by side);
// then ours only: the first painted frame is already dark (no white flash), the
// user menu's System / Light / Dark switch and survive a reload, and the screens
// stay readable (axe colour contrast on the list, a post, a draft, menus and
// dialogs, in dark). Stills go to e2e/evidence/. Not a CI gate.
const ID = 'post-03'
const shot = (name: string, step: string) => `evidence/J45-${name}-${step}.png`
const DARK_BG = 'rgb(19, 20, 27)'
test.use({colorScheme: 'dark'})
test.setTimeout(90_000)
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).restore(ID, {title: 'Fixture post 03'})))

const contrast = async (page: Page) =>
  (await new AxeBuilder({page}).withRules(['color-contrast']).analyze()).violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n')[1]?.trim()}`))

test('@evidence J45: dark mode — system, menu choice, reload, no flash, readable', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  // What the very first painted frame shows (ours sets the theme before any paint).
  await context.addInitScript(() => {
    requestAnimationFrame(() => ((window as {__firstBg?: string}).__firstBg = getComputedStyle(document.documentElement).getPropertyValue('--bg') || getComputedStyle(document.body).backgroundColor))
  })
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.waitForTimeout(800)
  await page.screenshot({path: shot(t.name, '1-system-dark')})
  test.skip(t.name === 'sanity', 'the rest checks ours; Sanity is the still above')

  expect(await page.evaluate(() => (window as {__firstBg?: string}).__firstBg?.trim()), 'first frame is dark').toMatch(/#13141b|rgb\(19, 20, 27\)/)
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(await bodyBg()).toBe(DARK_BG)

  // Readable in dark: contrast on the post, a menu, a dialog, the draft state.
  const problems: string[] = [...(await contrast(page))]
  await page.getByRole('button', {name: 'Document actions'}).last().click()
  problems.push(...(await contrast(page)))
  await page.screenshot({path: shot(t.name, '2-menu')})
  await page.keyboard.press('Escape')
  await t.field(page, 'title').click()
  await page.keyboard.press('Control+Alt+i')
  await expect(page.getByRole('dialog').filter({hasText: 'Inspecting'})).toBeVisible()
  problems.push(...(await contrast(page)))
  await page.screenshot({path: shot(t.name, '3-inspect')})
  await page.keyboard.press('Escape')
  await page.getByRole('tab', {name: 'Meta'}).click()
  problems.push(...(await contrast(page)))
  await page.screenshot({path: shot(t.name, '4-meta')})
  // A draft, Review changes and History; then the Delete confirm.
  await page.getByRole('tab', {name: 'Content'}).click()
  await t.field(page, 'title').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' dark')
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toMatchObject({draft: 'Fixture post 03 dark'})
  await page.getByRole('button', {name: /Review changes/}).first().click()
  await page.waitForTimeout(800)
  problems.push(...(await contrast(page)))
  await page.screenshot({path: shot(t.name, '5-review')})
  await page.keyboard.press('Escape')
  await page.getByRole('button', {name: 'Show document actions'}).click()
  await page.getByRole('menuitem', {name: 'History'}).click()
  await page.waitForTimeout(1500)
  problems.push(...(await contrast(page)))
  await page.screenshot({path: shot(t.name, '6-history')})
  await page.goBack()
  await page.getByRole('button', {name: 'Document actions'}).last().click()
  await page.getByRole('menuitem', {name: 'Delete'}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  problems.push(...(await contrast(page)))
  await page.screenshot({path: shot(t.name, '7-delete')})
  await page.keyboard.press('Escape')
  expect(problems, 'colour contrast in dark').toEqual([])

  // The user menu: Light, then reload — it stays light although the OS is dark.
  const menu = async (label: string) => {
    await page.getByRole('button', {name: 'Open user menu'}).click()
    await page.getByRole('menuitemradio', {name: label}).click()
  }
  await menu('Use light appearance')
  expect(await bodyBg()).toBe('rgb(255, 255, 255)')
  await page.reload()
  await t.settle(page)
  expect(await bodyBg()).toBe('rgb(255, 255, 255)')
  await page.getByRole('button', {name: 'Open user menu'}).click()
  await expect(page.getByRole('menuitemradio', {name: 'Use light appearance'})).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({path: shot(t.name, '8-light-chosen')})
  await page.keyboard.press('Escape')

  // Dark with the OS in light; then System follows the OS again.
  await page.emulateMedia({colorScheme: 'light'})
  await menu('Use dark appearance')
  await page.reload()
  await t.settle(page)
  expect(await bodyBg()).toBe(DARK_BG)
  await menu('Use system appearance')
  expect(await bodyBg()).toBe('rgb(255, 255, 255)')
  await page.emulateMedia({colorScheme: 'dark'})
  await expect.poll(bodyBg).toBe(DARK_BG)
})
