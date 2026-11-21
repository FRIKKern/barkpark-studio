import {expect, test} from '../rig/test'
import {closeAndSettle, signInIfAsked, target} from '../rig/targets'

// G4 (task-20bc1ba720eafef2): an integer with Sanity's options.list as radios, fieldTypes.perPage
// ([3, 6], layout "radio"). Only what a browser shows: a stored value outside the list checks
// nothing, is said and stays; a click stores the number; an arrow key moves the choice. The
// reader, validation, paste and every write path are node tests (app/src/lib/list-options.test.ts).
const ID = 'field-types-01'
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).resetDoc(ID, 'fieldTypes')))

test('an integer list as radios: 4 outside the list stays and is said; a click stores 6, ArrowUp 3', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours; the reference has the same field (reference/sanity fieldTypes)')
  await t.prepare(context)
  await t.patch(ID, {perPage: 4}, 'fieldTypes')
  await page.goto(t.docPath('fieldTypes', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const value = () => t.docValue(ID, 'perPage', 'fieldTypes')
  const perPage = page.locator('[id="perPage"]')
  await expect(perPage.getByRole('radio', {checked: true})).toHaveCount(0)
  await expect(perPage).toHaveAccessibleDescription('Validation error: Value "4" did not match any allowed values')
  expect(await value()).toBe(4)
  await perPage.getByRole('radio', {name: '6', exact: true}).check()
  await expect.poll(value, {timeout: 10_000}).toBe(6)
  await page.keyboard.press('ArrowUp')
  await expect.poll(value, {timeout: 10_000}).toBe(3)
})
