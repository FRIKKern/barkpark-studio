import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// The Releases calendar is one Tab stop, as a WAI-ARIA grid and Sanity's date picker: Tab
// lands on today, arrow keys move a day or a week (into the next month), Tab leaves it.
test('@local Releases: the calendar is one Tab stop; arrow keys move between days', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's Releases calendar is locked behind its plan")
  await t.prepare(page.context())
  await page.goto('/releases')
  await page.locator('html[data-hydrated]').waitFor()
  await page.getByRole('button', {name: 'Go to next month'}).focus()
  await page.keyboard.press('Tab')
  const today = page.locator('.cal-day[data-today]')
  await expect(today).toBeFocused()
  const key = (await today.getAttribute('data-key'))!
  const [y, m, d] = key.split('-').map(Number)
  const day = (offset: number) => new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10)
  await page.keyboard.press('ArrowDown')
  await expect(page.locator(`.cal-day[data-key="${day(7)}"]`)).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator(`.cal-day[data-key="${day(6)}"]`)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', {name: 'Go to today'})).toBeFocused()
})
