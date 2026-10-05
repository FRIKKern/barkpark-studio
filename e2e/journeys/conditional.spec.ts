import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// J30 evidence, both studios: the same steps, one screenshot per step plus a clip,
// saved under e2e/evidence/ (local, gitignored) for the side-by-side sign-off.
// Not a CI gate: J30 is not a QUALITY.md rule-5 journey (`pnpm evidence` runs it).
// Hidden: featuredNote shows only while featured is on. Read-only: reviewNote locks
// once stage is "done" (post-04), stays editable before (post-03).
const shot = (name: string, step: string) => `evidence/J30-${name}-${step}.png`
test.use({video: 'on'})

test.afterEach(async ({}, info) => target(info).resetDoc('post-05', 'post'))

test('@evidence J30: conditional fields', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', 'post-05'))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  const pane = t.pane(page, 2)
  const note = t.field(page, 'featuredNote')
  await expect(note).toHaveValue('Featured in the post 5 newsletter.')
  await pane.screenshot({path: shot(t.name, '1-featured-note-shown')})

  // Switch featured off: the note goes at once, focus stays on the switch.
  await t.field(page, 'featured').click()
  await expect(note).toHaveCount(0)
  await expect(t.field(page, 'featured')).toBeFocused()
  await pane.screenshot({path: shot(t.name, '2-featured-off-note-hidden')})
  await t.field(page, 'featured').click()
  await expect(note).toHaveValue('Featured in the post 5 newsletter.')

  // Read-only once done; editable before.
  await page.goto(t.docPath('post', 'post-04'))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  await expect(t.field(page, 'reviewNote')).toHaveAttribute('readonly', '')
  await t.pane(page, 2).screenshot({path: shot(t.name, '3-done-review-note-read-only')})
  await page.goto(t.docPath('post', 'post-03'))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  await expect(t.field(page, 'reviewNote')).not.toHaveAttribute('readonly')
  await t.pane(page, 2).screenshot({path: shot(t.name, '4-review-review-note-editable')})
})
