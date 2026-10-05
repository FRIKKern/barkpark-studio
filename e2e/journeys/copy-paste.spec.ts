import {expect, test, type Locator, type Page} from '@playwright/test'
import {target, type Target} from '../rig/targets'

// J29 evidence, both studios: the field "…" menu copies one field and pastes it
// into another of the same type; a mismatched paste is refused with Sanity's
// toast; the document "…" menu copies a whole post into another. Stills + clips
// go to e2e/evidence/ (gitignored). Not a CI gate (`pnpm evidence` runs it).
// Ours leaves pasted drafts behind: re-seed after (`pnpm reset`).
const FROM = 'post-22'
const TO = 'post-23'
const shot = (name: string, step: string) => `evidence/J29-${name}-${step}.png`
test.use({video: 'on', permissions: ['clipboard-read', 'clipboard-write']})

async function fieldMenu(t: Target, page: Page, field: string, item: 'Copy field' | 'Paste field') {
  const box = t.name === 'sanity' ? page.locator(`[data-testid="field-${field}"]`) : page.locator('.field').filter({has: page.locator(`[id="${field}"]`)}).last()
  await box.hover()
  const button =
    t.name === 'sanity'
      ? page.locator(`[data-testid="field-actions-menu-${field}"] button[aria-label="Field actions"]`)
      : box.locator(':scope > .field-actions button[aria-label="Field actions"]')
  await (await openMenu(t, page, button)).getByRole('menuitem', {name: item}).click()
}
// Sanity keeps its menus mounted (hidden); take the one the button controls.
async function openMenu(t: Target, page: Page, button: Locator) {
  const id = t.name === 'sanity' ? await button.first().getAttribute('id') : null
  await button.first().click()
  if (!id) return page.getByRole('menu')
  await page.waitForTimeout(300) // its menu animates in; an early click is lost
  return page.locator(`[role=menu][aria-labelledby="${id}"]`)
}
const docMenu = (t: Target, page: Page) =>
  t.name === 'sanity'
    ? t.pane(page, 2).locator('button:has([data-sanity-icon="ellipsis-horizontal"])').first()
    : page.getByRole('button', {name: 'Show document actions'})

test.afterEach(async ({}, info) => {
  const t = target(info)
  await t.restore(FROM, {title: 'Fixture post 22'})
  await t.restore(TO, {title: 'Fixture post 23'})
})

test('@evidence J29: copy and paste a field and a document', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', FROM))
  await t.settle(page)

  // Excerpt (text) → title (string): same base type, lands.
  await fieldMenu(t, page, 'excerpt', 'Copy field')
  await fieldMenu(t, page, 'title', 'Paste field')
  await expect(t.field(page, 'title')).toHaveValue('Short excerpt for post 22.')
  await t.pane(page, 2).screenshot({path: shot(t.name, '1-pasted-into-title')})

  // Text → number: refused with a toast, rating unchanged.
  await page.getByRole('tab', {name: 'Meta'}).click()
  const rating = await t.field(page, 'rating').inputValue()
  await fieldMenu(t, page, 'rating', 'Paste field')
  await expect(page.getByText('Source and target schema types are not compatible')).toBeVisible()
  await expect(t.field(page, 'rating')).toHaveValue(rating)
  await page.screenshot({path: shot(t.name, '2-incompatible-toast')})

  // Whole document → another post.
  await (await openMenu(t, page, docMenu(t, page))).getByRole('menuitem', {name: 'Copy document'}).click()
  // Both studios put a plain-text copy on the system clipboard.
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Fixture SEO.')
  await page.goto(t.docPath('post', TO))
  await t.settle(page)
  const menu = await openMenu(t, page, docMenu(t, page))
  await expect(menu.getByRole('menuitem', {name: 'Paste document'})).toBeVisible()
  await page.screenshot({path: shot(t.name, '3-document-menu')})
  await menu.getByRole('menuitem', {name: 'Paste document'}).click()
  await expect(t.field(page, 'title')).toHaveValue('Short excerpt for post 22.')
  await expect(t.field(page, 'excerpt')).toHaveValue('Short excerpt for post 22.')
  await t.pane(page, 2).screenshot({path: shot(t.name, '4-document-pasted')})
})
