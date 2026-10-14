import {expect, test} from '@playwright/test'
import {closeAndSettle, signInIfAsked, target} from '../rig/targets'

// The field-type matrix (2026-10-13), ours: what Sanity draws for these options and we
// didn't. An array of strings from a list is checkboxes and keeps the list's order; a
// geopoint is three numbers and stays a geopoint; a reference with disableNew offers no
// Create; a generated slug stops at maxLength; a checkbox boolean; an object's fieldset
// folds and the document's own sits width beside height; dates show and take their dateFormat/timeFormat; a grid array is tiles. Sanity's side: fieldTypes in reference/sanity (stills, not a gate).
const ID = 'field-types-01'
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).resetDoc(ID, 'fieldTypes')))

test("field types: Sanity's options for lists, geopoints, references, slugs, booleans and fieldsets", async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours; Sanity is the reference stills')
  await t.prepare(context)
  await page.goto(t.docPath('fieldTypes', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const value = (field: string) => t.docValue(ID, field, 'fieldTypes')

  // dateFormat / timeFormat (DD.MM.YYYY, HH:mm): shown in them, typed in them, stored as Sanity stores.
  await expect(page.locator('[id="day"]')).toHaveValue('13.10.2026')
  await expect(page.locator('[id="at"]')).toHaveValue(/^13\.10\.2026 \d\d:15$/)
  await page.locator('[id="day"]').fill('14.10.2026')
  await page.keyboard.press('Enter')
  await expect.poll(() => value('day'), {timeout: 10_000}).toBe('2026-10-14')

  // An array of objects with layout 'grid' is tiles; a tile opens its item.
  const cards = page.locator('[id="cards"] .array-box')
  await expect(cards).toHaveAttribute('data-layout', 'grid')
  await cards.getByRole('button', {name: 'One'}).click()
  await expect(page.getByRole('dialog', {name: /Cards \/ One/})).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(page.locator('[id="agree"]')).toHaveAttribute('type', 'checkbox')
  await expect(page.locator('[id="agree"]')).not.toHaveAttribute('role', 'switch')

  await page.getByRole('group').filter({has: page.getByRole('checkbox', {name: 'Green'})}).getByRole('checkbox', {name: 'Green'}).check()
  await expect.poll(() => value('colours'), {timeout: 10_000}).toEqual(['red', 'green', 'blue'])

  await page.locator('[id="place.lat"]').fill('60.5')
  await expect.poll(() => value('place'), {timeout: 10_000}).toMatchObject({_type: 'geopoint', lat: 60.5, lng: 10.7522})

  await page.locator('[id="title"]').fill('A title far longer than twenty characters')
  await page.getByRole('button', {name: 'Generate'}).click()
  await expect(page.locator('[id="handle"]')).toHaveValue('a-title-far-longer-t')

  await page.getByRole('button', {name: 'Where'}).click()
  await expect(page.locator('[id="address.street"]')).toHaveCount(0)
  await expect(page.getByRole('group', {name: 'Size'}).locator('[id="width"], [id="height"]')).toHaveCount(2)

  await page.getByRole('button', {name: 'Reference actions'}).click()
  await page.getByRole('menuitem', {name: /Replace/}).click()
  await expect(page.locator('[id="weakRef"]')).toBeFocused()
  const refField = page.locator('[id="weakRef"]').locator('xpath=ancestor::*[contains(@class, "field")][1]')
  await expect(refField.getByRole('button', {name: /^Create/})).toHaveCount(0)
})
