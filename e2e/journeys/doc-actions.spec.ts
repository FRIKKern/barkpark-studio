import {expect, test, type Locator, type Page} from '@playwright/test'
import {target, type Target} from '../rig/targets'

// J28 evidence, both studios: share (copy document URL / ID), Inspect with
// Ctrl+Alt+I (Parsed and Raw JSON), Duplicate from the footer menu, which opens
// the copy in place. Stills + clips go to e2e/evidence/ (gitignored). Not a CI
// gate (`pnpm evidence` runs it).
const ID = 'post-27'
const TITLE = 'Fixture post 27'
const shot = (name: string, step: string) => `evidence/J28-${name}-${step}.png`
test.use({video: 'on', permissions: ['clipboard-read', 'clipboard-write']})

// Sanity keeps its menus mounted (hidden); take the one the button controls.
async function openMenu(t: Target, page: Page, button: Locator) {
  const id = t.name === 'sanity' ? await button.first().getAttribute('id') : null
  await button.first().click()
  if (!id) return page.getByRole('menu')
  await page.waitForTimeout(300) // its menu animates in; an early click is lost
  return page.locator(`[role=menu][aria-labelledby="${id}"]`)
}
const shareButton = (t: Target, page: Page) =>
  t.name === 'sanity' ? t.pane(page, 2).locator('button:has([data-sanity-icon="share"])') : page.getByRole('button', {name: 'Share document'})
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

let duplicated: string | undefined
test.afterEach(async ({}, info) => {
  const t = target(info)
  if (duplicated) await t.deleteDoc(duplicated, 'post')
  duplicated = undefined
  await t.restore(ID, {title: TITLE})
})

test('@evidence J28: share, inspect, duplicate', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)

  // Share: copy the ID, then the URL; each confirmed by a toast.
  let menu = await openMenu(t, page, shareButton(t, page))
  await expect(menu.getByRole('menuitem', {name: 'Copy document ID'})).toBeVisible()
  await page.screenshot({path: shot(t.name, '1-share-menu')})
  await menu.getByRole('menuitem', {name: 'Copy document ID'}).click()
  await expect(page.getByText('Document ID copied to clipboard')).toBeVisible()
  await expect.poll(() => clipboard(page)).toMatch(/^(drafts\.)?post-27$/)
  menu = await openMenu(t, page, shareButton(t, page))
  await menu.getByRole('menuitem', {name: 'Copy document URL'}).click()
  await expect(page.getByText('Document URL copied to clipboard')).toBeVisible()
  await expect.poll(() => clipboard(page)).toContain('post-27')

  // Inspect: Ctrl+Alt+I from inside the form.
  await t.field(page, 'title').click()
  await page.keyboard.press('Control+Alt+i')
  const dialog = page.getByRole('dialog').filter({hasText: 'Inspecting'})
  await expect(dialog).toContainText(`Inspecting ${TITLE}`)
  await expect(dialog).toContainText('post-27')
  await page.screenshot({path: shot(t.name, '2-inspect-parsed')})
  await dialog.getByRole('tab', {name: 'Raw JSON'}).click()
  await expect(dialog).toContainText('"_id": "post-27"')
  await page.screenshot({path: shot(t.name, '3-inspect-raw')})
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // Duplicate: the copy opens in this pane, same content, a new id.
  menu = await openMenu(t, page, t.docMenu(page))
  await menu.getByRole('menuitem', {name: 'Duplicate'}).click()
  await expect.poll(() => decodeURIComponent(page.url())).toMatch(/\/structure\/post;[0-9a-f-]{36}$/)
  duplicated = decodeURIComponent(page.url()).match(/;([0-9a-f-]{36})$/)![1]
  await expect(t.field(page, 'title')).toHaveValue(TITLE)
  await expect(page.getByText('The document was successfully duplicated')).toBeVisible()
  await page.screenshot({path: shot(t.name, '4-duplicated')})
})
