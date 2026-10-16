import {expect, test, type Page} from '@playwright/test'
import {target} from '../rig/targets'

// J24 + J25, both studios: list search (as you type, empty state) and the list's
// "…" menu (sort sticks across a reload).
const firstRow = (page: Page) => page.locator('a[href^="/structure/post;"]').first()
const firstTitle = async (page: Page) => (await firstRow(page).innerText()).split('\n')[0]

test("@local J24 J25 J55: list search, empty state, the type's own sort that sticks", async ({page}, info) => {
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
  await expect(list.getByText('No results found')).toBeVisible()
  const clear = t.name === 'sanity' ? list.locator('button:has([data-sanity-icon="close"])').first() : list.getByRole('button', {name: 'Clear search'})
  await clear.click()
  await expect(page.getByPlaceholder('Search list')).toBeFocused()
  await expect(page.getByPlaceholder('Search list')).toHaveValue('')

  // J25 + J55: sort by one of the type's own orderings (rating, highest; ties in
  // creation order), survives a reload; back to the default.
  try {
    await t.listMenu(list).click()
    await page.getByText('Sort by Rating, highest').click()
    await expect.poll(() => firstTitle(page)).toBe('Fixture post 05')
    await page.reload()
    await t.settle(page)
    await expect.poll(() => firstTitle(page)).toBe('Fixture post 05')
  } finally {
    await t.listMenu(t.pane(page, 1)).click()
    await page.getByText('Default sort').click()
  }
})

// The search box is a combobox over the rows, as Sanity's: typing lights the first
// result, ArrowDown moves the light, Enter opens the lit document; the box names it.
test('@local J24: list search keys — the first result lit, ArrowDown moves it, Enter opens it', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.listPath('post'))
  await t.settle(page)
  const box = page.getByRole('combobox', {name: 'Search list'})
  await box.click()
  await page.keyboard.type('fixture post')
  await expect(box).toHaveAttribute('aria-activedescendant', /-item-0$/)
  await page.keyboard.press('ArrowDown')
  await expect(box).toHaveAttribute('aria-activedescendant', /-item-1$/)
  const id = (await box.getAttribute('aria-activedescendant'))!
  const lit = page.locator(`[id="${id}"]`)
  // Lit as a row under the pointer is, in Sanity's hover fill.
  await expect(lit.locator('a').first()).toHaveCSS('background-color', 'rgb(246, 246, 248)')
  const title = (await lit.innerText()).split('\n')[0]!
  await page.keyboard.press('Enter')
  await expect(t.field(page, 'title')).toHaveValue(title)
})

// First run: a dataset with no schema says so (Sanity's "No document types" card) instead of
// an empty desk, and lists none of the studio's own items (their types are not there).
// A dataset nobody writes to; read only.
test('first run: a dataset with no document types shows Sanity\'s card', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours (Sanity: the same card, in the evidence stills)')
  // A PR that changes fixture schemas runs with them read from the checkout (e2e.yml), so
  // every dataset shows the fixture types there.
  test.skip(process.env.BARKPARK_SCHEMA_SOURCE === 'fixtures', 'schemas come from the checkout, not the dataset')
  await t.prepare(page.context())
  await page.goto(`/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/d/e2e-no-schema-ever/structure`)
  await t.settle(page)
  const pane = page.locator('[data-pane="types"]')
  await expect(pane.getByRole('status')).toContainText('No document types')
  await expect(pane.getByRole('link', {name: 'Learn how to add a document type →'})).toHaveAttribute('href', /schema-reference/)
  await expect(pane.locator('.type-row')).toHaveCount(0)
})

// J19 (a CI gate): Sanity's list keys. From a row, ArrowDown / ArrowUp move a row, End /
// Home to the last / first loaded row, Enter opens it; the list is one Tab stop. Nothing is written.
test('J19: a list is one Tab stop; rows move by arrow keys, Home and End; Enter opens', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Sanity's list moves an active row (aria-activedescendant), not focus")
  await t.prepare(page.context())
  await page.goto(t.listPath('post'))
  await t.settle(page)
  const rows = page.locator('section.pane.list a[href*=";"]')
  const href = (i: number) => rows.nth(i).getAttribute('href')
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('href'))
  await rows.first().focus()
  await page.keyboard.press('ArrowDown')
  expect(await focused()).toBe(await href(1))
  await page.keyboard.press('ArrowUp')
  expect(await focused()).toBe(await href(0))
  await page.keyboard.press('End')
  expect(await focused()).toBe(await href((await rows.count()) - 1))
  // One Tab stop, as Sanity's: from the search box Tab enters the list, the next Tab leaves it.
  await page.getByRole('combobox', {name: 'Search list'}).focus()
  await page.keyboard.press('Tab')
  expect(await focused()).toBe(await href(0))
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('.list-rows')), 'Tab left the list').toBe(false)
  // The last pane: the next Tab starts at the page's top (the navbar), not on the row under the first.
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('.list-rows')), 'the next Tab re-entered the list').toBe(false)
  await rows.first().focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${(await href(1))!.split(';').pop()}$`))
})
