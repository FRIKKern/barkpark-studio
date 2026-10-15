import {expect, test} from '@playwright/test'
import {bpBase, bpDataset, signInIfAsked, target} from '../rig/targets'

// J40, Sanity's Schedule publish: a draft is scheduled from the document menu
// ("Schedule draft for publishing", a future time), the header and a banner say so, the
// scheduled draft is locked, and the banner's "Pause to edit" (or Delete schedule) takes
// it back. Barkpark runs the publish at that time as the editor
// (/v1/data/schedules, Barkpark #22775); a Barkpark without the route offers no Schedule.
test('J40: schedule a draft for publishing; it is locked until Pause to edit', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "the check runs on ours; Sanity's dialog is the evidence clip")
  const route = await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  test.skip(route.status === 404, 'this Barkpark has no scheduled publishes yet (#22775)')
  const id = `post-schedule-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'Schedule probe', slug: {_type: 'slug', current: id}})
  try {
    await t.prepare(context)
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('button', {name: 'Document actions', exact: true}).click()
    await page.getByRole('menuitem', {name: 'Schedule publish'}).click()
    const dialog = page.getByRole('dialog', {name: 'Schedule draft for publishing'})
    // It opens on now: not in the future, so Schedule waits (Sanity's warning).
    await expect(dialog.getByRole('alert')).toHaveText('Schedule for a future time and date.')
    await expect(dialog.getByRole('button', {name: 'Schedule'})).toBeDisabled()
    const at = new Date(Date.now() + 2 * 86_400_000)
    await dialog.locator('input[type=datetime-local]').fill(new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16))
    await dialog.getByRole('button', {name: 'Schedule'}).click()
    await expect(page.locator('.chip[data-tone=scheduled]')).toHaveText('Scheduled publish')
    await expect(page.locator('.pane-banner[data-tone=scheduled]')).toContainText('Scheduled to be published on')
    // Locked, as Sanity's scheduled version; the menu still offers Delete schedule.
    await expect(t.field(page, 'title')).toBeDisabled()
    await page.getByRole('button', {name: 'Document actions', exact: true}).click()
    await expect(page.getByRole('menuitem', {name: 'Delete schedule'})).toBeEnabled()
    await page.keyboard.press('Escape')
    // Pause to edit: the schedule goes, the draft stays and is editable again.
    await page.locator('.pane-banner[data-tone=scheduled]').getByRole('button', {name: 'Pause to edit'}).click()
    await expect(page.locator('.chip[data-tone=scheduled]')).toBeHidden()
    await expect(t.field(page, 'title')).toBeEnabled()
    await expect(t.field(page, 'title')).toHaveValue('Schedule probe')
  } finally {
    await t.deleteDoc(id, 'post')
  }
})
