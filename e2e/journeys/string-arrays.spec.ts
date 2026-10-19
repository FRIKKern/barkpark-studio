import {expect, test, type Page} from '@playwright/test'
import {closeAndSettle, target, type Target} from '../rig/targets'

// J34 evidence, both studios: tags (Enter adds, × removes) and a plain string
// array (reorder by keyboard and by mouse, item "…" menu). Stills + clips go to
// e2e/evidence/ (gitignored). That one is not a CI gate (`pnpm evidence` runs it); the
// two after it are.
// The post goes back to the seed after the run, on both sides.
const ID = 'post-20'
const HL = ['Point one of post 20', 'Point two of post 20', 'Point three of post 20']
const shot = (name: string, step: string) => `evidence/J34-${name}-${step}.png`
// The clip is the evidence test's (CI skips it; its runner has no ffmpeg for the two CI tests below).
test.use({video: process.env.CI ? 'off' : 'on'})

const values = (page: Page) => page.locator('input[id^="highlights["]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
const handles = (t: Target, page: Page) =>
  (t.name === 'sanity' ? page.locator('[data-testid="field-highlights"]') : page.locator('#highlights')).locator('button[aria-roledescription="sortable"]')
const field = (t: Target, page: Page, name: string) => (t.name === 'sanity' ? page.locator(`[data-testid="field-${name}"]`) : page.locator('.field').filter({has: page.locator(`[id="${name}"]`)}).last())

// The seed's post back after every run, on both sides (a failed run must not leave the next one dirty).
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).resetDoc(ID, 'post')))

test('@evidence J34: tags and a reorderable string array', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  await field(t, page, 'highlights').scrollIntoViewIfNeeded()
  await expect.poll(() => values(page), {intervals: [50]}).toEqual(HL)
  await t.pane(page, 2).screenshot({path: shot(t.name, '1-tags-and-rows')})

  // Tags: Enter adds, × removes.
  await t.field(page, 'tags').click()
  await page.keyboard.type('alpha')
  await page.keyboard.press('Enter')
  await expect.poll(() => t.docValue(ID, 'tags'), {timeout: 10_000}).toEqual(['fixture', 't0', 'alpha'])
  if (t.name === 'sanity') await field(t, page, 'tags').locator('[data-testid="change-bar__field-wrapper"] button').first().click()
  else await page.getByRole('button', {name: 'Remove fixture'}).click()
  await expect.poll(() => t.docValue(ID, 'tags'), {timeout: 10_000}).toEqual(['t0', 'alpha'])

  // Keyboard: pick up the first row, one down, drop.
  // Sanity's drag library reacts on the next frames: give each key a moment there.
  const press = async (key: string) => (await page.keyboard.press(key), t.name === 'sanity' && (await page.waitForTimeout(200)))
  await handles(t, page).first().focus()
  for (const key of ['Space', 'ArrowDown', 'Space']) await press(key)
  await expect.poll(() => values(page), {intervals: [50]}).toEqual([HL[1], HL[0], HL[2]])

  // Mouse: drag the last row above the first.
  const from = await handles(t, page).last().boundingBox()
  const to = await handles(t, page).first().boundingBox()
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
  await page.mouse.down()
  await page.mouse.move(to!.x + to!.width / 2, to!.y - 4, {steps: 12})
  await page.mouse.up()
  await expect.poll(() => values(page), {intervals: [50]}).toEqual([HL[2], HL[1], HL[0]])
  await expect.poll(() => t.docValue(ID, 'highlights'), {timeout: 10_000}).toEqual([HL[2], HL[1], HL[0]])

  // Item menu: Remove the middle row.
  await page.locator('[id="highlights[1]-menuButton"]').click()
  await page.getByRole('menu').filter({visible: true}).getByRole('menuitem', {name: 'Remove'}).click()
  await expect.poll(() => values(page), {intervals: [50]}).toEqual([HL[2], HL[0]])
  await t.pane(page, 2).screenshot({path: shot(t.name, '2-after-edits')})
})

// Add item puts the caret in the new item, as Sanity's: what is typed next lands there
// (ours left it on the button, and saved the item empty).
test('J34: Add item on a string array focuses the new item', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  await field(t, page, 'highlights').getByRole('button', {name: 'Add item', exact: true}).click()
  await expect(page.locator('[id="highlights[3]"]')).toBeFocused()
  await page.keyboard.type('Point four')
  await expect.poll(() => t.docValue(ID, 'highlights'), {timeout: 10_000}).toEqual([...HL, 'Point four'])
})

// Where ours beats Sanity's: the Enter that commits an IME's word is not a new tag (both
// studios added the half-composed text). The next, plain Enter adds it.
test('J34: the Enter an IME commits with adds no tag', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Sanity's adds it: ours goes beyond")
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  const input = page.locator('[id="tags"]')
  await input.fill('かんじ')
  await input.dispatchEvent('keydown', {key: 'Enter', code: 'Enter', isComposing: true, bubbles: true})
  await expect(field(t, page, 'tags').locator('.tag')).toHaveText(['fixture', 't0'])
  await expect(input).toHaveValue('かんじ')
  await input.press('Enter')
  await expect.poll(() => t.docValue(ID, 'tags'), {timeout: 10_000}).toEqual(['fixture', 't0', 'かんじ'])
})
