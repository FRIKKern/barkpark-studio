import {expect, test} from '../rig/test'
import {closeAndSettle, signInIfAsked, target} from '../rig/targets'

// The field-type matrix (2026-10-13), ours: what Sanity draws for these options and we
// didn't. An array of strings from a list is checkboxes and keeps the list's order; a
// geopoint is three numbers and stays a geopoint; a reference with disableNew offers no
// Create; a generated slug stops at maxLength; a checkbox boolean; an object's fieldset
// folds and the document's own sits width beside height; dates show and take their dateFormat/timeFormat; a grid array is tiles. Sanity's side: fieldTypes in reference/sanity (stills, not a gate).
const ID = 'field-types-01'
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).resetDoc(ID, 'fieldTypes')))

// CI: what is stored, as Sanity stores it (data; the rest of the matrix is drawn, @local below).
test('field types store as Sanity: a dateFormat date, a list in its order, "1,500" never 1.5, a geopoint', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours; Sanity is the reference stills')
  await t.prepare(context)
  await page.goto(t.docPath('fieldTypes', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const value = (field: string) => t.docValue(ID, field, 'fieldTypes')
  // dateFormat (DD.MM.YYYY): typed in it, stored as Sanity stores it.
  await page.locator('[id="day"]').fill('14.10.2026')
  await page.keyboard.press('Enter')
  await expect.poll(() => value('day'), {timeout: 10_000}).toBe('2026-10-14')
  // An array of strings from a list keeps the list's order, whatever order it was ticked in.
  await page.getByRole('group').filter({has: page.getByRole('checkbox', {name: 'Green'})}).getByRole('checkbox', {name: 'Green'}).check()
  await expect.poll(() => value('colours'), {timeout: 10_000}).toEqual(['red', 'green', 'blue'])
  // English: "1,500" is one thousand five hundred, never 1.5 (a decimal comma is nb's,
  // lib/number.ts): not a number, so the field is unset and keeps what was typed.
  await page.locator('[id="width"]').fill('1,500')
  await expect.poll(() => value('width'), {timeout: 10_000}).toBeUndefined()
  await expect(page.locator('[id="width"]')).toHaveValue('1,500')
  // ...and the field says so, so a shown value is never silently unset (task-cad5d4a8ee5f7893).
  const widthAlert = page.locator('.field').filter({has: page.locator('[id="width"]')}).getByRole('alert')
  await expect(widthAlert).toHaveText('Not a number')
  await page.locator('[id="width"]').fill('1200')
  await expect.poll(() => value('width'), {timeout: 10_000}).toBe(1200)
  await expect(widthAlert).toBeHidden()
  // Up steps a number, as Sanity's <input type="number"> does.
  await page.locator('[id="width"]').press('ArrowUp')
  await expect.poll(() => value('width'), {timeout: 10_000}).toBe(1201)
  // Typed fast, every key counts (an older save's echo put its number back under the caret:
  // "123456789012345" was stored as 12356825), and a letter does nothing, as in Sanity's.
  const width = page.locator('[id="width"]')
  await width.fill('')
  await width.pressSequentially('123456789012', {delay: 5})
  await width.pressSequentially('x')
  await expect.poll(() => value('width'), {timeout: 10_000}).toBe(123456789012)
  await expect(width).toHaveValue('123456789012')
  // A geopoint stays a geopoint.
  await page.locator('[id="place.lat"]').fill('60.5')
  await expect.poll(() => value('place'), {timeout: 10_000}).toMatchObject({_type: 'geopoint', lat: 60.5, lng: 10.7522})
})

test("@local field types: Sanity's options drawn: dates, grid tiles, a checkbox, Add item, slugs, fieldsets, a reference without Create", async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours; Sanity is the reference stills')
  await t.prepare(context)
  await page.goto(t.docPath('fieldTypes', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(page.locator('[id="day"]')).toHaveValue('13.10.2026')
  await expect(page.locator('[id="at"]')).toHaveValue(/^13\.10\.2026 \d\d:15$/)
  // An array of objects with layout 'grid' is tiles; a tile opens its item.
  const cards = page.locator('[id="cards"] .array-box')
  await expect(cards).toHaveAttribute('data-layout', 'grid')
  const tile = (await cards.getByRole('button', {name: 'One'}).boundingBox())!
  expect(Math.round(tile.height)).toBe(Math.round(tile.width)) // Sanity's square tile, its title for screen readers only
  await cards.getByRole('button', {name: 'One'}).click()
  await expect(page.getByRole('dialog', {name: /Cards \/ One/})).toBeVisible()
  // Over the pane's card area (Sanity's), not 137 px down it.
  expect(await page.locator('.item-backdrop').boundingBox()).toEqual(await page.locator('.doc-main').boundingBox())
  await page.keyboard.press('Escape')
  await expect(page.locator('[id="agree"]')).toHaveAttribute('type', 'checkbox')
  await expect(page.locator('[id="agree"]')).not.toHaveAttribute('role', 'switch')
  // One member type: Sanity's plain "Add item" (the "…" menu is for several).
  await expect(page.locator('[id="cards"]').getByRole('button', {name: 'Add item', exact: true})).toBeVisible()
  await page.locator('[id="title"]').fill('A title far longer than twenty characters')
  await page.getByRole('button', {name: 'Generate'}).click()
  // maxLength 20, cut on a word as Sanity's speakingurl cuts it (not mid-word; lib/slug.test.ts in CI).
  await expect(page.locator('[id="handle"]')).toHaveValue('a-title-far-longer')
  await page.getByRole('button', {name: 'Where'}).click()
  await expect(page.locator('[id="address.street"]')).toHaveCount(0)
  await expect(page.getByRole('group', {name: 'Size'}).locator('[id="width"], [id="height"]')).toHaveCount(2)
  await page.getByRole('button', {name: 'Reference actions'}).click()
  await page.getByRole('menuitem', {name: /Replace/}).click()
  await expect(page.locator('[id="weakRef"]')).toBeFocused()
  const refField = page.locator('[id="weakRef"]').locator('xpath=ancestor::*[contains(@class, "field")][1]')
  await expect(refField.getByRole('button', {name: /^Create/})).toHaveCount(0)
})

test('@local field types: an unset checkbox boolean shows indeterminate', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours; Sanity is the reference stills')
  await t.prepare(context)
  await page.goto('/intent/create/type=fieldTypes')
  await signInIfAsked(page)
  const agree = page.locator('[id="agree"]')
  await expect(agree).toHaveAttribute('type', 'checkbox')
  expect(await agree.evaluate((e) => (e as HTMLInputElement).indeterminate)).toBe(true)
})
