import {expect, test, type Page} from '@playwright/test'
import {installProbes, timeToReady} from '../rig/feel'
import {target} from '../rig/targets'

// J26, both studios: split a doc pane right, edit on both sides (each side sees the
// other's keystrokes, focus stays put), close the split.
const ID = 'post-26'
const path = (page: Page) => decodeURIComponent(new URL(page.url()).pathname)

test.afterEach(async ({page}, info) => {
  const t = target(info)
  const titles = page.locator('[id="title"]')
  if (!(await titles.count())) return // a skipped target never opened or edited the fixture
  const title = await titles.last().inputValue()
  try {
    // Do not let a queued reference save overwrite the fixture reset.
    if (title !== undefined) await expect.poll(() => t.docValue(ID, 'title', 'post')).toBe(title)
  } finally {
    await page.close()
    await t.resetDoc(ID, 'post')
  }
})

test('@local J26: typing in an earlier tablet split keeps it expanded', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'Regression for our field-path URL update; reference is recorded separately')
  await t.prepare(page.context())
  await page.setViewportSize({width: 768, height: 900})
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByLabel('Split pane right').click()
  await page.locator('[data-pane-index="2"][data-pane-collapsed]').click()
  const title = t.pane(page, 2).locator('[id="title"]')
  await title.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' tablet', {delay: 80})
  await expect(title).toHaveValue('Fixture post 26 tablet')
  await expect(title).toBeFocused()
  await expect(page).toHaveURL(/path=title/)
})

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
  if (t.name === 'studio') await page.waitForTimeout(650) // finish the first undo group
  await titles.nth(1).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' right')
  await expect(titles.nth(0)).toHaveValue('Fixture post 26 left right')
  await expect(titles.nth(1)).toBeFocused()

  if (t.name === 'studio') {
    // Undo and the duplicate field label must target the right-hand pane instance.
    await page.keyboard.press('ControlOrMeta+z')
    await expect(titles.nth(1)).toBeFocused()
    await expect(titles.nth(0)).toHaveValue('Fixture post 26 left')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(titles.nth(1)).toBeFocused()
    await expect(titles.nth(0)).toHaveValue('Fixture post 26 left right')
    await titles.nth(0).click()
    await t.pane(page, 3).locator('label[for="title"]').click()
    await expect(titles.nth(1)).toBeFocused()
  }

  // Close the right side: one pane, the edit kept.
  await t.closeSplit(t.pane(page, 3)).click()
  await expect(titles).toHaveCount(1)
  expect(path(page)).toBe(`/structure/post;${ID}${t.name === 'studio' ? ',path=title' : ''}`)
  await expect(titles).toHaveValue('Fixture post 26 left right')

  if (t.name === 'studio') {
    expect(split.ms, 'F2 split opens').toBeLessThan(100)
    expect(split.cls, `F2 zero layout shift (moved: ${split.shifted})`).toBe(0)
    await page.getByText(/^Saved$/).waitFor() // let the last write land before the reset
  }
})
