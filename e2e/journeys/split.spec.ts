import {expect, test, type Page} from '@playwright/test'
import {installProbes, timeToReady} from '../rig/feel'
import {target} from '../rig/targets'

// J26, both studios: split a doc pane right, edit on both sides (each side sees the
// other's keystrokes, focus stays put), close the split.
const ID = 'post-26'
const path = (page: Page) => decodeURIComponent(new URL(page.url()).pathname)

test.afterEach(async ({}, info) => target(info).resetDoc(ID, 'post'))

test('@local J26: split pane right, edit both sides, close the split', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.prepare(page.context()), installProbes(page.context())])
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const titles = page.locator('[id="title"]')

  const split = await timeToReady(page, page.getByLabel('Split pane right'), `() => document.querySelectorAll('[id="title"]').length === 2`, null)
  expect(path(page)).toBe(`/structure/post;${ID}|,`)
  await expect(titles.nth(1)).toHaveValue('Fixture post 26')

  // Left types, right follows; then the other way round. Focus never jumps.
  await titles.nth(0).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' left')
  await expect(titles.nth(1)).toHaveValue('Fixture post 26 left')
  await titles.nth(1).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' right')
  await expect(titles.nth(0)).toHaveValue('Fixture post 26 left right')
  await expect(titles.nth(1)).toBeFocused()

  // Close the right side: one pane, the edit kept.
  await t.closeSplit(t.pane(page, 3)).click()
  await expect(titles).toHaveCount(1)
  expect(path(page)).toBe(`/structure/post;${ID}`)
  await expect(titles).toHaveValue('Fixture post 26 left right')

  if (t.name === 'studio') {
    expect(split.ms, 'F2 split opens').toBeLessThan(100)
    expect(split.cls, `F2 zero layout shift (moved: ${split.shifted})`).toBe(0)
    await page.getByText(/^Saved$/).waitFor() // let the last write land before the reset
  }
})
