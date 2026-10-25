import {expect, test} from '../rig/test'
import {target} from '../rig/targets'

// D02, as LiveView's Classic form of a block-list type: note's body (its layout region) is
// read-only here, says so, and its button opens the Freeform view. Read-only on note-01.
test("@local D02: Classic says a Freeform type's body is edited in Freeform, and goes there", async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  await t.prepare(page.context())
  await page.goto(t.docPath('note', 'note-01'))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Classic'}).click()
  await expect(page.getByText('This body is written in blocks, which the Classic form cannot save. Edit it in Freeform.')).toBeVisible()
  await page.getByRole('button', {name: 'Edit the body in Freeform'}).click()
  await expect(page.getByRole('tab', {name: 'Freeform'})).toHaveAttribute('aria-selected', 'true')
})
