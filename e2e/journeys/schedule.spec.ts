import {expect, test} from '../rig/test'
import {bpBase, bpDataset, bpMutate, signInIfAsked, target} from '../rig/targets'

// J40, Sanity's Schedule publish: a draft is scheduled from the document menu
// ("Schedule draft for publishing", a future time), the header and a banner say so, the
// scheduled draft is locked, the banner's "Pause to edit" (or Delete schedule) takes it
// back, and "Publish now" publishes it at once. Barkpark runs the publish at that time as the editor
// (/v1/data/schedules, Barkpark #22775); a Barkpark without the route offers no Schedule.
// The Releases tool's scheduled drafts: releases.spec.
test('J40: schedule a draft for publishing; it is locked until Pause to edit; Publish now publishes it', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "the check runs on ours; Sanity's dialog is the evidence clip")
  const route = await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  test.skip(route.status === 404, 'this Barkpark has no scheduled publishes yet (#22775)')
  const id = `post-schedule-${Date.now().toString(36)}`
  // A draft only, created outright: the id is new, so no leftover to delete first (t.draftOnly's).
  await bpMutate([{create: {_id: id, _type: 'post', title: 'Schedule probe', slug: {_type: 'slug', current: id}}}])
  try {
    await t.prepare(context)
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('button', {name: 'Open document actions', exact: true}).click()
    await page.getByRole('menuitem', {name: 'Schedule publish'}).click()
    const dialog = page.getByRole('dialog', {name: 'Schedule draft for publishing'})
    // It opens on now: not in the future, so Schedule waits (Sanity's warning).
    await expect(dialog.getByRole('alert')).toHaveText('Schedule for a future time and date.')
    await expect(dialog.getByRole('button', {name: 'Schedule'})).toBeDisabled()
    const at = new Date(Date.now() + 2 * 86_400_000)
    // Sanity's text field and its calendar (task-7821e8da66b7d5a9): today's past days can't be
    // picked and the calendar says why; the field reads "Oct 18, 2026 10:00".
    await dialog.getByRole('button', {name: 'Open calendar'}).click()
    const calendar = page.getByRole('dialog', {name: 'Select date'})
    await expect(calendar.getByRole('alert')).toHaveText('Select a date in the future.')
    await expect(calendar.locator('.dp-zone')).toHaveText(/^\s*(GMT([+-]\d+)?|UTC|[A-Z]{3,5})$/)
    const yesterday = new Date(Date.now() - 86_400_000)
    if (yesterday.getMonth() === new Date().getMonth()) await expect(calendar.getByLabel(yesterday.toDateString())).toBeDisabled()
    await page.keyboard.press('Escape')
    const field = dialog.getByLabel('Publish on')
    await expect(field).toHaveValue(/^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}$/)
    await field.fill(`${at.toLocaleString('en-US', {month: 'short'})} ${at.getDate()}, ${at.getFullYear()} 10:00`)
    await field.press('Enter')
    await dialog.getByRole('button', {name: 'Schedule'}).click()
    await expect(page.locator('.chip[data-tone=scheduled]')).toHaveText('Scheduled publish')
    await expect(page.locator('.pane-banner[data-tone=scheduled]')).toContainText('Scheduled to be published on')
    // Locked, as Sanity's scheduled version; the menu still offers Delete schedule.
    await expect(t.field(page, 'title')).toBeDisabled()
    await page.getByRole('button', {name: 'Open document actions', exact: true}).click()
    await expect(page.getByRole('menuitem', {name: 'Delete schedule'})).toBeEnabled()
    await page.keyboard.press('Escape')
    // Pause to edit: the draft is editable again and the schedule is paused, not deleted
    // (Barkpark #23198), as Sanity's. The footer's Schedule reactivates it at its own time.
    await page.locator('.pane-banner[data-tone=scheduled]').getByRole('button', {name: 'Pause to edit'}).click()
    await expect(t.field(page, 'title')).toBeEnabled()
    await expect(t.field(page, 'title')).toHaveValue('Schedule probe')
    await expect(page.getByText('Schedule paused while editing. Press Schedule to reactivate or pick a new date.')).toBeVisible()
    await expect(page.locator('.chip[data-tone=scheduled]')).toBeVisible()
    await page.locator('.doc-footer').getByRole('button', {name: 'Schedule publish'}).click()
    await dialog.getByRole('button', {name: 'Schedule'}).click()
    await expect(t.field(page, 'title')).toBeDisabled()
    // Publish now: Sanity's confirm, then published at once and the schedule gone.
    await expect(page.locator('.chip[data-tone=scheduled]')).toBeVisible()
    await page.getByRole('button', {name: 'Open document actions', exact: true}).click()
    await page.getByRole('menuitem', {name: 'Publish now'}).click()
    await page.getByRole('dialog', {name: 'Publish draft now'}).getByRole('button', {name: 'Yes, run now'}).click()
    await expect(page.locator('.chip[data-tone=scheduled]')).toBeHidden()
    await expect(page.getByRole('button', {name: /^Published/}).first()).toBeEnabled()
    await expect.poll(() => t.publishedTitle(id)).toBe('Schedule probe')
  } finally {
    await t.deleteDoc(id, 'post')
  }
})
