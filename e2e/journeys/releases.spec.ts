import AxeBuilder from '@axe-core/playwright'
import {expect, test} from '../rig/test'
import {bpBase, bpDataset, bpMutate, signInIfAsked, target} from '../rig/targets'

// J40's Releases tool (the schedule itself, from the document: schedule.spec; split for
// CI's shards, task-c1df532bed870536).

// Sanity's Releases tool, its Scheduled drafts view (task-ad9c942d7d48c887): every scheduled
// draft in the dataset, Active / Paused / Archived; a row opens its document, and its menu
// pauses or deletes the schedule. The perspective menu's View Scheduled Drafts opens it.
// Its month calendar and time zone, as Sanity's (task-f8d14f136de4ed6d): the day with a
// schedule is bold, a click shows that day's schedules (again: all), and a picked zone
// changes only how the time reads; Barkpark keeps it in UTC. One draft and one page load for
// both (CI's budget: each was its own seed, schedule and studio load).
test('Releases tool: scheduled drafts, calendar day filter and time zone, Active / Paused / Archived, row actions', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours; Sanity's is measured by hand (plan-gated releases)")
  const api = `${bpBase()}/v1/data/schedules/${bpDataset()}`
  const headers = {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`, 'content-type': 'application/json'}
  test.skip((await fetch(api, {headers})).status === 404, 'this Barkpark has no scheduled publishes yet (#22775)')
  const id = `post-releases-${Date.now().toString(36)}`
  const title = `Releases probe ${id.slice(-6)}`
  const at = new Date(Date.now() + 2 * 86_400_000)
  at.setUTCHours(8, 0, 0, 0)
  // The draft and its schedule are made while the browser gets ready (as refs.spec, #935).
  // A draft only, created outright: the id is new, so no leftover to delete first (t.draftOnly's).
  const [made] = await Promise.all([
    bpMutate([{create: {_id: id, _type: 'post', title, slug: {_type: 'slug', current: id}}}]).then(() => fetch(api, {method: 'POST', headers, body: JSON.stringify({id, type: 'post', publishAt: at.toISOString()})})),
    t.prepare(context),
  ])
  try {
    expect(made.ok, await made.clone().text()).toBe(true)
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('button', {name: 'Perspective'}).click()
    await page.getByRole('menuitem', {name: 'View Scheduled Drafts'}).click()
    await expect(page).toHaveURL(/\/releases/)
    await expect(page.locator('.navbar .tool.tab')).toHaveText('Releases')
    const row = page.getByRole('row').filter({hasText: title})
    await expect(row).toContainText('Scheduled ·')
    const {violations} = await new AxeBuilder({page}).include('.releases').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    // The calendar: the browser runs in UTC or not, so the day is the one its own clock says.
    const label = await page.evaluate((iso) => new Date(new Date(iso).toLocaleDateString('en-CA') + 'T12:00:00Z').toDateString(), at.toISOString())
    const calendar = page.getByRole('complementary', {name: 'Calendar'})
    if (!(await calendar.getByLabel(label).count())) await calendar.getByRole('button', {name: 'Go to next month'}).click()
    const day = calendar.getByLabel(label)
    await expect(day).toHaveAttribute('data-marked')
    await day.click()
    await expect(page.locator('.releases-day')).toBeVisible()
    await expect(row).toBeVisible()
    await expect(page.getByRole('button', {name: 'Active', exact: true})).toHaveCount(0)
    await day.click()
    await expect(page.getByRole('button', {name: 'Active', exact: true})).toBeVisible()
    // A phone: Sanity's calendar is behind a button, in a "View calendar" dialog; a pick closes it.
    const wide = page.viewportSize()!
    await page.setViewportSize({width: 390, height: 844})
    await expect(calendar).toBeHidden()
    await page.getByRole('button', {name: 'View calendar'}).click()
    const sheet = page.getByRole('dialog', {name: 'View calendar'})
    if (!(await sheet.getByLabel(label).count())) await sheet.getByRole('button', {name: 'Go to next month'}).click()
    await sheet.getByLabel(label).click()
    await expect(sheet).toHaveCount(0)
    await expect(row).toBeVisible()
    await page.locator('.releases-day').getByRole('button', {name: 'Clear'}).click()
    await page.setViewportSize(wide)
    // New York: the same instant, read there and named.
    await page.locator('.releases-zone').click()
    const zone = page.getByRole('dialog', {name: 'Select time zone'})
    await zone.getByRole('combobox').fill('New York')
    await zone.getByRole('option', {name: /New York/}).click()
    await zone.getByRole('button', {name: 'Update time zone'}).click()
    await expect(page.locator('.releases-zone')).toContainText('(America/New York)')
    await expect(page.getByText('Time zone updated')).toBeVisible()
    const ny = at.toLocaleString('en-US', {timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit'})
    await expect(row).toContainText(new RegExp(`${ny} \\((EDT|EST)\\)`))
    expect((await (await fetch(`${api}?id=${id}&type=post&status=all`, {headers})).json()).result.schedules[0].publishAt).toMatch(/T08:00:00/)
    // Pause to edit: the row moves to Paused.
    await row.getByRole('button', {name: 'Scheduled draft actions'}).click()
    await page.getByRole('menuitem', {name: 'Pause to edit'}).click()
    await expect(row).toHaveCount(0)
    await page.getByRole('button', {name: 'Paused', exact: true}).click()
    await expect(row).toContainText('Paused ·')
    // Delete schedule: archived, and the draft stays.
    await row.getByRole('button', {name: 'Scheduled draft actions'}).click()
    await page.getByRole('menuitem', {name: 'Delete schedule'}).click()
    await page.getByRole('dialog', {name: 'Delete scheduled draft'}).getByRole('button', {name: 'Yes, delete schedule'}).click()
    await expect(row).toHaveCount(0)
    await page.getByRole('button', {name: 'Archived', exact: true}).click()
    await expect(row.first()).toContainText('Deleted ·')
    // The row opens its document.
    await row.first().getByRole('link', {name: title}).click()
    await expect(t.field(page, 'title')).toHaveValue(title)
  } finally {
    // A schedule left behind would stay Active with its document gone.
    const list = (await (await fetch(`${api}?id=${id}&type=post&status=all`, {headers})).json()) as {result: {schedules: {_id: string; status: string}[]}}
    for (const s of list.result.schedules.filter((x) => x.status === 'scheduled' || x.status === 'paused')) await fetch(`${api}/${s._id}`, {method: 'DELETE', headers})
    await t.deleteDoc(id, 'post')
  }
})

// The zone button names the zone in the browser's language, as Sanity's
// (task-556f6d421d271155): an en-GB browser in Oslo reads "CEST (Europe/Oslo)" (CET in winter).
test.describe('an en-GB browser in Oslo', () => {
  test.use({locale: 'en-GB', timezoneId: 'Europe/Oslo'})
  test('Releases tool: the zone in the browser\'s own words', async ({page, context}, info) => {
    const t = target(info)
    test.skip(t.name === 'sanity', 'ours')
    await t.prepare(context)
    await page.goto('/releases')
    await signInIfAsked(page)
    await t.settle(page)
    await expect(page.locator('.releases-zone')).toHaveText(/^\s*CES?T \(Europe\/Oslo\)\s*$/)
  })
})
