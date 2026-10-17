import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// Barkpark-native track, after LiveView's media Refine column: each format the library holds
// is a row with its count (Barkpark's mimeType facet); picking one filters the grid to it,
// picking it again lets go. Read-only.
test('B08: Refine by format lists the formats with their counts and filters by one', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  await t.prepare(page.context())
  await page.goto('/media')
  const format = page.getByRole('group', {name: 'Format'})
  const png = format.getByRole('button', {name: /^image\/png/})
  await expect(png).toBeVisible()
  const n = Number(await png.locator('.media-kind-count').textContent())
  await png.click()
  await expect(png).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.media-count')).toHaveText(n === 1 ? '1 asset' : n > 50 ? new RegExp(`of ${n} assets$`) : `${n} assets`)
  await expect(page.locator('.media-grid .media-name').first()).toHaveText(/\.png$/)
  await png.click()
  await expect(png).toHaveAttribute('aria-pressed', 'false')
})
