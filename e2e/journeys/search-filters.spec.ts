import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J38, global search filters. Evidence on both studios: the dialog with its type
// picker and its "Add filter" menu open (stills to e2e/evidence/). Then the check
// on ours: a field filter narrows the results, a type without that field drops out,
// the order menu switches, the search survives a reopen, and comes back as a recent one.
const shot = (name: string, step: string) => `evidence/J38-${name}-${step}.png`
const dialog = (page: Page) => page.getByRole('dialog', {name: 'Search'})
// After the sign-in redirect the structure route may still be hydrating.
const openSearch = (page: Page) =>
  expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(dialog(page)).toBeVisible({timeout: 500})
  }).toPass()

test('@evidence J38: search filters side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  if (t.name === 'sanity') await page.keyboard.press('ControlOrMeta+k')
  else await openSearch(page)
  await page.keyboard.type('post')
  await page.waitForTimeout(1000)
  await page.screenshot({path: shot(t.name, '1-dialog')})
  await page.getByRole('button', {name: 'All types'}).click()
  await page.waitForTimeout(300)
  await page.screenshot({path: shot(t.name, '2-types')})
  await page.keyboard.press('Escape')
  await page.getByRole('button', {name: 'Add filter'}).click()
  await page.waitForTimeout(300)
  await page.screenshot({path: shot(t.name, '3-add-filter')})
})

test('@local J38: field filter, type filter, order, recent searches', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.addInitScript(() => localStorage.removeItem('bp-recent-searches'))
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  await openSearch(page)
  const results = dialog(page).getByRole('listbox', {name: 'Search results'})

  // A field filter alone narrows the search (no query typed): picked from the
  // "Add filter" list by typing, its value box takes the caret.
  await dialog(page).getByRole('button', {name: 'Add filter'}).click()
  await page.keyboard.type('excerpt')
  await page.keyboard.press('Enter')
  await page.keyboard.type('post 12')
  await expect(results.getByRole('option')).toHaveCount(1)
  await expect(results.getByText('Fixture post 12', {exact: true})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page).getByRole('button', {name: 'Excerpt contains post 12'})).toBeVisible()

  // Authors have no excerpt: with only Author picked, nothing is asked.
  await dialog(page).getByRole('button', {name: 'All types'}).click()
  await page.keyboard.type('auth')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(dialog(page).getByText('No results found')).toBeVisible()
  await dialog(page).getByRole('button', {name: 'Author'}).click()
  await page.getByRole('button', {name: 'Clear checked filters'}).click()
  await page.keyboard.press('Escape')
  await expect(results.getByRole('option')).toHaveCount(1)

  // The order menu.
  await dialog(page).getByRole('button', {name: 'Best match'}).click()
  await page.getByRole('menuitemradio', {name: 'Created: Newest first'}).click()
  await expect(dialog(page).getByRole('button', {name: 'Created: Newest first'})).toBeVisible()

  // Open a result. The search is still there on reopen (Sanity's); cleared, it is a recent one, filter and all.
  await dialog(page).getByRole('combobox').fill('fixture')
  await expect(results.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(t.field(page, 'title')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(dialog(page).getByRole('combobox')).toHaveValue('fixture')
  await dialog(page).getByRole('button', {name: 'Clear filters'}).click()
  await dialog(page).getByRole('button', {name: 'Clear', exact: true}).click()
  const recent = dialog(page).getByRole('listbox', {name: 'Recent searches'}).getByRole('option')
  await expect(recent).toHaveAccessibleName('fixture, Excerpt contains post 12')
  await page.keyboard.press('Enter')
  await expect(results.getByText('Fixture post 12', {exact: true})).toBeVisible()
  await dialog(page).getByRole('button', {name: 'Clear filters'}).click()
  await dialog(page).getByRole('button', {name: 'Clear', exact: true}).click()
  await dialog(page).getByRole('button', {name: 'Clear recent searches'}).click()
  await expect(recent).toHaveCount(0)

  // Every text field is searched, not only titles (Sanity's): "newsletter" is in the posts' featured note.
  await dialog(page).getByRole('combobox').fill('newsletter')
  await expect(results.getByText('Fixture post 05', {exact: true})).toBeVisible()
})
