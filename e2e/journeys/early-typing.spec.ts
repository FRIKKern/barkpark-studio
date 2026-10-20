import {expect, test} from '@playwright/test'
import {bpMutate, bpRemove, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// task-6fe143f72dc55f55: keys typed into the server-drawn form before React has it are kept.
// They were silently lost (the inputs look editable from the first paint; Sanity's appear
// only once they work). A slow CPU (6x) keeps the page inert long enough to type into it.
// A scratch post, deleted after (and checked gone).
test('keys typed before hydration are saved, not dropped', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's form is drawn on the client")
  const id = `post-early-${Date.now().toString(36)}`
  await bpMutate([{createOrReplace: {_id: id, _type: 'post', title: 'Early'}}])
  try {
    await t.prepare(page.context())
    // Signed in first (a sign-in page would be the first paint otherwise).
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    const held: (() => void)[] = []
    let holding = true
    await page.route('**/*', (r) => (holding && r.request().resourceType() === 'script' ? void held.push(() => void r.continue()) : r.continue()))
    await page.goto(t.docPath('post', id), {waitUntil: 'commit'})
    const title = t.field(page, 'title')
    await title.waitFor()
    await title.click()
    await page.keyboard.press('ControlOrMeta+ArrowRight')
    await page.keyboard.type(' typed', {delay: 20})
    expect(await page.locator('html[data-hydrated]').count(), 'the keys went in before hydration').toBe(0)
    holding = false
    for (const go of held) go()
    await t.settle(page)
    await expect.poll(() => t.docValue(id, 'title'), {timeout: 10_000}).toBe('Early typed')
    await expect(title).toHaveValue('Early typed')
  } finally {
    // Closed first: a save still on its way would write the draft again after the delete.
    await closeAndSettle(page)
    await bpRemove(id, 'post')
  }
})

// task-c044d1ebab1e53dd: the same for a checkbox, a select and a checkbox list ticked or picked
// on the inert form; they reverted to their stored state once React had them.
test('a checkbox, select and checkbox list changed before hydration are saved', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's form is drawn on the client")
  const id = `ft-early-${Date.now().toString(36)}`
  await bpMutate([{createOrReplace: {_id: id, _type: 'fieldTypes', title: 'Early controls'}}])
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('fieldTypes', id))
    await signInIfAsked(page)
    await t.settle(page)
    const held: (() => void)[] = []
    let holding = true
    await page.route('**/*', (r) => (holding && r.request().resourceType() === 'script' ? void held.push(() => void r.continue()) : r.continue()))
    await page.goto(t.docPath('fieldTypes', id), {waitUntil: 'commit'})
    await page.locator('[id="agree"]').check()
    await page.locator('[id="choice"]').selectOption('1')
    await page.locator('[id="colours"] input[type=checkbox]').first().check()
    expect(await page.locator('html[data-hydrated]').count(), 'changed before hydration').toBe(0)
    holding = false
    for (const go of held) go()
    await t.settle(page)
    await expect.poll(async () => [await t.docValue(id, 'agree', 'fieldTypes'), await t.docValue(id, 'choice', 'fieldTypes'), await t.docValue(id, 'colours', 'fieldTypes')], {timeout: 10_000}).toEqual([true, 'b', ['red']])
    await expect(page.locator('[id="agree"]')).toBeChecked()
  } finally {
    // Closed first: a save still on its way would write the draft again after the delete.
    await closeAndSettle(page)
    await bpRemove(id, 'fieldTypes')
  }
})

// The list's search box too: typed into before hydration, the list searches for it once live.
// @local: search-box keys are lower stakes than stored data; CI keeps the form's two above.
test('@local a list search typed before hydration searches once live', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's list is drawn on the client")
  await t.prepare(page.context())
  await page.goto(t.listPath('post'))
  await signInIfAsked(page)
  await t.settle(page)
  const held: (() => void)[] = []
  let holding = true
  await page.route('**/*', (r) => (holding && r.request().resourceType() === 'script' ? void held.push(() => void r.continue()) : r.continue()))
  await page.goto(t.listPath('post'), {waitUntil: 'commit'})
  await page.getByRole('combobox', {name: 'Search list'}).fill('Fixture post 07')
  expect(await page.locator('html[data-hydrated]').count(), 'typed before hydration').toBe(0)
  holding = false
  for (const go of held) go()
  await t.settle(page)
  await expect(t.listItem(page, 'post-07')).toBeVisible()
  await expect(t.listItem(page, 'post-02')).toHaveCount(0)
})

// A control with no id and no id'd field around it is found again by its label: the media
// tool's Sort picked before hydration sorts once live.
test('@local a labelled control without an id keeps its early change (media Sort)', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's media tool is drawn on the client")
  await t.prepare(page.context())
  await page.goto('/media')
  await signInIfAsked(page)
  await t.settle(page)
  const held: (() => void)[] = []
  let holding = true
  await page.route('**/*', (r) => (holding && r.request().resourceType() === 'script' ? void held.push(() => void r.continue()) : r.continue()))
  await page.goto('/media', {waitUntil: 'commit'})
  await page.getByRole('combobox', {name: 'Sort'}).selectOption('created-asc')
  expect(await page.locator('html[data-hydrated]').count(), 'picked before hydration').toBe(0)
  holding = false
  for (const go of held) go()
  await t.settle(page)
  await expect(page).toHaveURL(/[?&]sort=created-asc/)
})
