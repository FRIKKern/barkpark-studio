import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// Barkpark-native track, after LiveView's media Refine column: each format the library holds
// is a row with its count (Barkpark's mimeType facet); picking one filters the grid to it,
// picking it again lets go. Read-only, on whatever the dataset holds (a CI dataset: one text file).
test('@local B08: Refine by format lists the formats with their counts and filters by one', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  await t.prepare(page.context())
  await page.goto('/media')
  const format = page.getByRole('group', {name: 'Format'})
  const row = format.getByRole('button').first()
  await expect(row).toHaveText(/^[a-z]+\/[\w.+-]+\d+$/)
  const n = Number(await row.locator('.media-kind-count').textContent())
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.media-count')).toHaveText(n === 1 ? '1 asset' : n > 50 ? new RegExp(`of ${n} assets$`) : `${n} assets`)
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'false')
})

// LiveView's "/ to focus": / anywhere outside a text field puts the caret in the media search.
test('@local B08: / puts the caret in the media search', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  await t.prepare(page.context())
  await page.goto('/media')
  await page.getByRole('group', {name: 'Format'}).getByRole('button').first().focus()
  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox', {name: 'Search media'})).toBeFocused()
  await expect(page.getByRole('searchbox', {name: 'Search media'})).toHaveValue('')
})
