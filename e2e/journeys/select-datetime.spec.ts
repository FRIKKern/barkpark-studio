import {expect, test, type Page} from '@playwright/test'
import {target, type Target} from '../rig/targets'

// J31 evidence, both studios: radio and dropdown select lists, then the date-time
// picker by mouse and by keyboard. Stills + clips go to e2e/evidence/ (gitignored)
// for the side-by-side sign-off. Not a CI gate (`pnpm evidence` runs it).
const ID = 'post-05'
const SEED = {stage: 'idea', format: 'tutorial', publishedAt: '2026-09-06T09:00:00Z'}
const shot = (name: string, step: string) => `evidence/J31-${name}-${step}.png`
test.use({video: 'on', timezoneId: 'Europe/Oslo'})

const calendarButton = (t: Target, page: Page) =>
  t.name === 'sanity'
    ? page.locator('[data-testid="field-publishedAt"] button:has([data-sanity-icon="calendar"])')
    : page.getByRole('button', {name: 'Select date'})

test.afterEach(async ({}, info) => target(info).restore(ID, SEED))

test('@evidence J31: select lists and the date-time picker', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  const pane = t.pane(page, 2)
  await expect(page.getByRole('radio', {name: 'Idea'})).toBeChecked()
  await expect(t.field(page, 'format').locator('option:checked')).toHaveText('Tutorial')
  await pane.screenshot({path: shot(t.name, '1-selects')})

  // Radio: pick Writing; dropdown: pick Article. Both land in the backend.
  await page.getByRole('radio', {name: 'Writing'}).click()
  await t.field(page, 'format').selectOption({label: 'Article'})
  await expect.poll(() => t.docValue(ID, 'stage'), {timeout: 10_000}).toBe('writing')
  await expect.poll(() => t.docValue(ID, 'format'), {timeout: 10_000}).toBe('article')

  // Date-time: the field shows local time; the picker opens on the selected day.
  const input = t.field(page, 'publishedAt')
  await expect(input).toHaveValue('2026-09-06 11:00')
  await calendarButton(t, page).click()
  await expect(page.getByRole('button', {name: 'Sun Sep 06 2026'})).toBeFocused()
  await page.screenshot({path: shot(t.name, '2-picker-open')})

  // Ours by keyboard (one day right, Enter); Sanity's grid ignores arrows on a
  // focused day (checked 2026-10-06), so the reference picks with the mouse. Time is kept.
  if (t.name === 'studio') {
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
  } else await page.getByRole('button', {name: 'Mon Sep 07 2026'}).click()
  await expect(input).toHaveValue('2026-09-07 11:00')
  await expect.poll(() => t.docValue(ID, 'publishedAt'), {timeout: 10_000}).toBe('2026-09-07T09:00:00.000Z')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', {name: 'Set to current time'})).toHaveCount(0)

  // A typed date commits when the field is left; "Set to current time" sets now.
  await input.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('2026-12-24 18:30')
  await page.keyboard.press('Tab')
  await expect.poll(() => t.docValue(ID, 'publishedAt'), {timeout: 10_000}).toBe('2026-12-24T17:30:00.000Z')
  await calendarButton(t, page).click()
  await page.screenshot({path: shot(t.name, '3-picker-december')})
  await page.getByRole('button', {name: 'Set to current time'}).click()
  await expect(input).toHaveValue(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  await expect(input).not.toHaveValue('2026-12-24 18:30')
})
