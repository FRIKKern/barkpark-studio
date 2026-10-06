import {expect, test, type Page} from '@playwright/test'
import {target, type Target} from '../rig/targets'

// J34 evidence, both studios: tags (Enter adds, × removes) and a plain string
// array (reorder by keyboard and by mouse, item "…" menu). Stills + clips go to
// e2e/evidence/ (gitignored). Not a CI gate (`pnpm evidence` runs it).
// Ours publishes the edits on restore: re-seed after (`pnpm reset`).
const ID = 'post-20'
const HL = ['Point one of post 20', 'Point two of post 20', 'Point three of post 20']
const shot = (name: string, step: string) => `evidence/J34-${name}-${step}.png`
test.use({video: 'on'})

const values = (page: Page) => page.locator('input[id^="highlights["]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
const handles = (t: Target, page: Page) =>
  (t.name === 'sanity' ? page.locator('[data-testid="field-highlights"]') : page.locator('#highlights')).locator('button[aria-roledescription="sortable"]')
const field = (t: Target, page: Page, name: string) => (t.name === 'sanity' ? page.locator(`[data-testid="field-${name}"]`) : page.locator('.field').filter({has: page.locator(`[id="${name}"]`)}).last())

test.afterEach(async ({}, info) => target(info).restore(ID, {title: 'Fixture post 20'}))

test('@evidence J34: tags and a reorderable string array', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  await field(t, page, 'highlights').scrollIntoViewIfNeeded()
  await expect.poll(() => values(page)).toEqual(HL)
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
  await expect.poll(() => values(page)).toEqual([HL[1], HL[0], HL[2]])

  // Mouse: drag the last row above the first.
  const from = await handles(t, page).last().boundingBox()
  const to = await handles(t, page).first().boundingBox()
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
  await page.mouse.down()
  await page.mouse.move(to!.x + to!.width / 2, to!.y - 4, {steps: 12})
  await page.mouse.up()
  await expect.poll(() => values(page)).toEqual([HL[2], HL[1], HL[0]])
  await expect.poll(() => t.docValue(ID, 'highlights'), {timeout: 10_000}).toEqual([HL[2], HL[1], HL[0]])

  // Item menu: Remove the middle row.
  await page.locator('[id="highlights[1]-menuButton"]').click()
  await page.getByRole('menu').filter({visible: true}).getByRole('menuitem', {name: 'Remove'}).click()
  await expect.poll(() => values(page)).toEqual([HL[2], HL[0]])
  await t.pane(page, 2).screenshot({path: shot(t.name, '2-after-edits')})
})
