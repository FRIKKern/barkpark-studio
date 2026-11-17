import {expect, test} from '../rig/test'
import {BACKEND_POLL, closeAndSettle, signInIfAsked, target} from '../rig/targets'

// J31 a datetime field's time zone, as Sanity's (task-a9e1da2562bec7a4), on fieldTypes.meetsAt
// (fixtures/barkpark-schema/fieldTypes.json: displayTimeZone America/New_York, allowTimeZoneSwitch):
// the box shows the stored instant on New York's clock with the zone button after the title; picking
// Europe/Oslo moves the shown time and writes nothing; a time typed on Oslo's clock stores its UTC
// instant. The browser is in Tokyo, so neither zone is this computer's. A dataset whose fieldTypes
// has no meetsAt yet (the CI pool until reseeded with --schemas) skips: its form has no such field.
const ID = `fieldTypes-zone-${Date.now().toString(36)}`
const AT = '2026-07-01T13:00:00.000Z'

test.use({timezoneId: 'Asia/Tokyo', locale: 'en-US'})
test.beforeEach(({}, info) => test.skip(target(info).name === 'sanity', "ours: Sanity's is the reference"))
test.afterEach(async ({page}, info) => (await closeAndSettle(page), await target(info).deleteDoc(ID, 'fieldTypes')))

test('J31 datetime zones: displayTimeZone shows New York, a switch to Oslo moves the time and writes nothing', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(ID, 'fieldTypes', {title: 'Zones', meetsAt: AT}), t.prepare(page.context())])
  await page.goto(t.docPath('fieldTypes', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(page.locator('[id="title"]')).toBeVisible()
  test.skip(!(await page.locator('[id="meetsAt"]').count()), "this dataset's fieldTypes schema has no meetsAt yet (reseed with --schemas)")

  const box = page.locator('[id="meetsAt"]')
  const zone = page.getByTestId('timezone-button')
  await expect(box).toHaveValue('2026-07-01 09:00')
  await expect(zone).toHaveText('New York')
  await zone.click()
  const dialog = page.getByRole('dialog', {name: 'Select time zone'})
  await expect(dialog).toContainText('only for this input in this document')
  await dialog.getByRole('combobox').fill('oslo')
  await dialog.getByRole('option', {name: /^Oslo \(GMT\+2\)/}).click()
  await dialog.getByRole('button', {name: 'Update time zone'}).click()
  await expect(dialog).toHaveCount(0)
  await expect(zone).toHaveText('Oslo')
  await expect(box).toHaveValue('2026-07-01 15:00')
  // Nothing to save: the zone is how the time is shown, not the time.
  expect(await page.evaluate(() => (window as unknown as {__savesPending: () => boolean}).__savesPending())).toBe(false)
  expect(await t.docValue(ID, 'meetsAt', 'fieldTypes')).toBe(AT)

  // Typed on Oslo's clock: 16:30 there is 14:30 UTC.
  await box.fill('2026-07-01 16:30')
  await box.press('Enter')
  await expect.poll(() => t.docValue(ID, 'meetsAt', 'fieldTypes'), BACKEND_POLL).toBe('2026-07-01T14:30:00.000Z')
})
