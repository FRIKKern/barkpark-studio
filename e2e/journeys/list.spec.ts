import {expect, test, type Page} from '@playwright/test'
import {target} from '../rig/targets'

// J24 + J25, both studios: list search (as you type, empty state) and the list's
// "…" menu (sort sticks across a reload).
const firstRow = (page: Page) => page.locator('a[href^="/structure/post;"]').first()
const firstTitle = async (page: Page) => (await firstRow(page).innerText()).split('\n')[0]

test('@local J24 J25: list search, empty state, sort that sticks', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.listPath('post'))
  await t.settle(page)
  const list = t.pane(page, 1)

  // J24: filter as you type; best title matches first; then nothing matches.
  await page.getByPlaceholder('Search list').click()
  // The word lives in rich-text blocks, not a top-level string field.
  await page.keyboard.type('Heading')
  await expect(firstRow(page)).toBeVisible()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('post 1')
  await expect.poll(() => firstTitle(page)).toMatch(/^Fixture post 1\d$/)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('zzzz')
  await expect(page.getByText('No results found')).toBeVisible()
  const clear = t.name === 'sanity' ? list.locator('button:has([data-sanity-icon="close"])').first() : list.getByRole('button', {name: 'Clear search'})
  await clear.click()
  await expect(page.getByPlaceholder('Search list')).toBeFocused()
  await expect(page.getByPlaceholder('Search list')).toHaveValue('')

  // J25: sort by title, survives a reload; back to the default.
  try {
    await t.listMenu(list).click()
    await page.getByText('Sort by Title').click()
    await expect.poll(() => firstTitle(page)).toBe('Fixture post 01')
    await page.reload()
    await t.settle(page)
    await expect.poll(() => firstTitle(page)).toBe('Fixture post 01')
  } finally {
    await t.listMenu(t.pane(page, 1)).click()
    await page.getByText('Default sort').click()
  }
})
