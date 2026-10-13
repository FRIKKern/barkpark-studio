import {expect, test} from '@playwright/test'
import {closeAndSettle, signInIfAsked, target} from '../rig/targets'

// The field-type matrix (2026-10-13), ours: what Sanity draws for these options and we
// didn't. An array of strings from a list is checkboxes and keeps the list's order; a
// geopoint is three numbers and stays a geopoint; a reference with disableNew offers no
// Create; a generated slug stops at maxLength; a checkbox boolean; an object's fieldset
// folds. Sanity's side: fieldTypes in reference/sanity (stills, not a gate).
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

  await page.getByRole('button', {name: 'Reference actions'}).click()
  await page.getByRole('menuitem', {name: /Replace/}).click()
  await expect(page.locator('[id="weakRef"]')).toBeFocused()
  const refField = page.locator('[id="weakRef"]').locator('xpath=ancestor::*[contains(@class, "field")][1]')
  await expect(refField.getByRole('button', {name: /^Create/})).toHaveCount(0)
})
