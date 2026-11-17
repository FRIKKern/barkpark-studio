import {expect, test} from '../rig/test'
import {BACKEND_POLL, closeAndSettle, signInIfAsked, target} from '../rig/targets'

// J33 array options, as Sanity's, on fieldTypes.steps (fixtures/barkpark-schema/fieldTypes.json):
// disableActions ['remove', 'duplicate'] leaves the item menu Copy and the two inserts; sortable: false
// draws no drag handle; modal {type: 'popover'} opens the item in a popover under its row, and Escape
// closes it with focus back on the row. Looking writes nothing. A dataset whose fieldTypes has no
// steps yet (the CI pool until reseeded with --schemas) skips: its form has no such field.
const ID = `fieldTypes-arrayoptions-${Date.now().toString(36)}`
const steps = [{_key: 'st1', label: 'Plan'}, {_key: 'st2', label: 'Build'}]

test.beforeEach(({}, info) => test.skip(target(info).name === 'sanity', "ours: Sanity's is the reference"))
test.afterEach(async ({page}, info) => (await closeAndSettle(page), await target(info).deleteDoc(ID, 'fieldTypes')))

test('J33 array options: disableActions and sortable: false shape the rows; a popover item opens by its row', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(ID, 'fieldTypes', {title: 'Array options', steps}), t.prepare(page.context())])
  await page.goto(t.docPath('fieldTypes', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(page.locator('[id="title"]')).toBeVisible()
  test.skip(!(await page.locator('[id="steps"]').count()), "this dataset's fieldTypes schema has no steps yet (reseed with --schemas)")

  const rows = page.locator('[id="steps"] > .array-box > .array-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.locator('.drag-handle')).toHaveCount(0)
  await page.locator('[id=\'steps[_key=="st1"]-menuButton\']').click()
  await expect(page.getByRole('menuitem')).toHaveText(['Copy', 'Add item before', 'Add item after'])
  await page.keyboard.press('Escape')

  const row = rows.first().locator('.array-item-preview')
  await row.click()
  const popover = page.getByRole('dialog', {name: 'Edit Step'})
  await expect(popover.locator('[id=\'steps[_key=="st1"].label\']')).toHaveValue('Plan')
  // By its row, 4 px from it, as Sanity's: under it, or over it with no room below.
  const box = popover.locator('xpath=..')
  const [r, p, side] = await Promise.all([row.boundingBox(), box.boundingBox(), box.getAttribute('data-side')])
  expect(Math.abs(side === 'top' ? r!.y - 4 - (p!.y + p!.height) : p!.y - (r!.y + r!.height + 4))).toBeLessThan(2)
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(row).toBeFocused()
  await expect.poll(() => t.docValue(ID, 'steps', 'fieldTypes'), BACKEND_POLL).toEqual(steps)
})
