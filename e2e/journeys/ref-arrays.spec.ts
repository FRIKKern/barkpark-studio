import {expect, test, type Page} from '@playwright/test'
import {target, type Target} from '../rig/targets'

// J09 evidence, both studios, on post-26's categories (a keyed reference array):
// add an item by search, move it by keyboard, the item "…" menu (Duplicate,
// Remove). Stills + clips go to e2e/evidence/. Not a CI gate.
// The categories go back to the seed's after the run, on both sides.
const ID = 'post-26'
const shot = (name: string, step: string) => `evidence/J09-${name}-${step}.png`
test.use({video: 'on'})

const catsField = (t: Target, page: Page) =>
  t.name === 'sanity' ? page.locator('[data-testid="field-categories"]') : page.locator('.field').filter({has: page.locator('[id="categories"]')}).last()
const refs = async (t: Target) => ((await t.docValue(ID, 'categories')) as {_ref?: string}[] | undefined)?.map((c) => c._ref ?? c) ?? []
async function itemMenu(t: Target, page: Page, row: number, item: string) {
  const button = catsField(t, page).locator('[id$="-menuButton"]').nth(row)
  const id = await button.getAttribute('id')
  await button.click()
  await page.waitForTimeout(t.name === 'sanity' ? 400 : 0)
  // Sanity keeps its menus mounted (hidden); take the one this button controls.
  const menu = t.name === 'sanity' ? page.locator(`[role=menu][aria-labelledby='${id}']`) : page.getByRole('menu')
  await menu.getByRole('menuitem', {name: item}).click()
}

const SEEDED = [{_type: 'reference', _ref: 'category-opinion', _key: 'c26'}]
test.afterEach(async ({}, info) => target(info).restore(ID, {title: 'Fixture post 26', categories: SEEDED}))

test('@evidence J09: reference array — add by search, reorder by keyboard, item menu', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const cats = catsField(t, page)
  await cats.scrollIntoViewIfNeeded()
  await expect(cats.getByRole('link', {name: /Opinion/})).toBeVisible()
  await cats.screenshot({path: shot(t.name, '1-rows')})

  // Add item: a row with the reference search, focused, so typing searches at once; pick News.
  await cats.getByRole('button', {name: /Add item/}).click()
  await expect(cats.getByRole('combobox').last()).toBeFocused()
  // Empty, the row is labelled and is a validation error: Publish waits for the pick.
  const publish = page.getByRole('button', {name: /^Publish$/}).last()
  await expect(cats.getByText('Reference to category')).toBeVisible()
  await expect(publish).toBeDisabled()
  await page.keyboard.type('News')
  await page.getByRole('option', {name: /News/}).first().click()
  await expect.poll(() => refs(t), {timeout: 10_000}).toEqual(['category-opinion', 'category-news'])
  await expect(cats.getByText('Reference to category')).toHaveCount(0)
  await expect(publish).toBeEnabled()

  // Keyboard: pick up News, one up, drop.
  const press = async (key: string) => (await page.keyboard.press(key), t.name === 'sanity' && (await page.waitForTimeout(200)))
  await cats.locator('button[aria-roledescription="sortable"]').last().focus()
  for (const key of ['Space', 'ArrowUp', 'Space']) await press(key)
  await expect.poll(() => refs(t), {timeout: 10_000}).toEqual(['category-news', 'category-opinion'])

  // Item menu: Duplicate the first, then Remove it.
  await itemMenu(t, page, 0, 'Duplicate')
  await expect.poll(() => refs(t), {timeout: 10_000}).toEqual(['category-news', 'category-news', 'category-opinion'])
  await cats.locator('[id$="-menuButton"]').first().click()
  await page.waitForTimeout(t.name === 'sanity' ? 400 : 0)
  await page.screenshot({path: shot(t.name, '2-item-menu')})
  await page.keyboard.press('Escape')
  await itemMenu(t, page, 0, 'Remove')
  await expect.poll(() => refs(t), {timeout: 10_000}).toEqual(['category-news', 'category-opinion'])
  await cats.screenshot({path: shot(t.name, '3-after')})
})
