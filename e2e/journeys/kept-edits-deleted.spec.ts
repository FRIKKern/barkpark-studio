import {expect, test, type Route} from '@playwright/test'
import {bpMutate, canvasFocusSettled, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// J32 widen (task-6612fd882f8b8b63): someone deletes the doc while you type. The save
// that was on its way meets the delete (404); every keystroke is kept, the deleted
// banner says so, and Restore brings the doc back with them on top. Ours only: Sanity
// loses them.
const ID = 'author-kept-at-delete'
const POST = 'post-kept-at-delete'
test.setTimeout(60_000)

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio') await bpMutate([{delete: {id: ID, type: 'author', force: true}}, {delete: {id: POST, type: 'post', force: true}}]).catch(() => {})
})

for (const frames of ['live', 'no live frame'] as const)
test(`keystrokes typed as the doc is deleted come back with Restore (${frames})`, async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity loses them')
  // CI once missed the delete's live frame and the pane never turned (de6987a, ci-4): the
  // save's 404 alone must show the deleted banner.
  if (frames !== 'live') await page.route('**/api/listen**', (route) => route.abort('failed'))
  await t.prepare(page.context())
  await bpMutate([{createOrReplace: {_id: ID, _type: 'author', title: 'Kept Author', name: 'Kept Author'}}, {publish: {id: ID, type: 'author'}}])
  await page.goto(t.docPath('author', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(t.field(page, 'name')).toHaveValue('Kept Author', {timeout: 15_000})
  // Saves are held on their way while the delete lands, then let go.
  const held: Route[] = []
  await page.route('**/_serverFn/**', (route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? void held.push(route) : route.continue()))
  await t.field(page, 'name').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' typed')
  await expect.poll(() => held.length).toBeGreaterThan(0)
  await bpMutate([{delete: {id: ID, type: 'author', force: true}}])
  for (const r of held.splice(0)) await r.continue()
  await page.unroute('**/_serverFn/**')
  const banner = page.getByRole('alert').filter({hasText: 'This document has been deleted.'})
  await expect(banner).toContainText('Your unsaved edits from', {timeout: 15_000})
  await page.screenshot({path: 'evidence/J32-kept-edits-deleted.png'})
  await banner.getByRole('button', {name: 'Restore most recent revision'}).click()
  await expect(t.field(page, 'name')).toHaveValue('Kept Author typed', {timeout: 15_000})
  await expect.poll(() => t.docValue(ID, 'name', 'author'), {timeout: 15_000}).toBe('Kept Author typed')
})

// The CI flake behind this (#446's first run, ci-5: "Kept Author", not "Kept Author typed"):
// after Restore, the kept edits were sent again made against the edited value itself, not
// the restored one (their base came from the screen, which already showed them). A change
// from Barkpark meanwhile then read as "the editor changed nothing here" and took theirs: the
// typing was lost. Here the re-sent save meets a newer rev (412) on purpose.
test('kept edits put back by Restore survive a newer version meanwhile', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only')
  await t.prepare(page.context())
  await bpMutate([{createOrReplace: {_id: ID, _type: 'author', title: 'Kept Author', name: 'Kept Author'}}, {publish: {id: ID, type: 'author'}}])
  await page.goto(t.docPath('author', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(t.field(page, 'name')).toHaveValue('Kept Author', {timeout: 15_000})
  const held: Route[] = []
  const hold = (route: Route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? void held.push(route) : route.continue())
  await page.route('**/_serverFn/**', hold)
  await t.field(page, 'name').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' typed')
  await expect.poll(() => held.length).toBeGreaterThan(0)
  await bpMutate([{delete: {id: ID, type: 'author', force: true}}])
  for (const r of held.splice(0)) await r.continue()
  const banner = page.getByRole('alert').filter({hasText: 'This document has been deleted.'})
  await expect(banner).toContainText('Your unsaved edits from', {timeout: 15_000})
  // Restore; the kept edits' save is held while Barkpark gets a newer version (same text).
  await banner.getByRole('button', {name: 'Restore most recent revision'}).click()
  await expect.poll(() => held.length, {timeout: 15_000}).toBeGreaterThan(0)
  // The restore has landed on Barkpark (the kept edits' save is still held).
  await expect.poll(() => t.docValue(ID, 'name', 'author'), {timeout: 15_000}).toBe('Kept Author')
  await bpMutate([{patch: {id: ID, type: 'author', set: {title: 'Kept Author, touched'}}}])
  await page.waitForTimeout(800) // its live frame arrives
  for (const r of held.splice(0)) await r.continue()
  await page.unrouteAll({behavior: 'wait'})
  await expect.poll(() => t.docValue(ID, 'name', 'author'), {timeout: 15_000}).toBe('Kept Author typed')
  await expect(t.field(page, 'name')).toHaveValue('Kept Author typed')
})

// The same for the body (task-89b5c425ca8b4506): its canvas goes with the deleted form, and
// the words it had not saved went with it. Now they are kept (D21), the banner says so, and
// after Restore the body offers them back.
test('@local body words typed as the doc is deleted are offered back after Restore', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity loses them')
  await t.prepare(page.context())
  const body = {blocks: [{id: 'p1', type: 'paragraph', content: [{type: 'text', value: 'First line.'}]}]}
  await bpMutate([{createOrReplace: {_id: POST, _type: 'post', title: 'Kept body', slug: {_type: 'slug', current: POST}, body}}, {publish: {id: POST, type: 'post'}}])
  await page.goto(t.docPath('post', POST))
  await signInIfAsked(page)
  await t.settle(page)
  const field = page.locator('[id="body"]')
  await field.scrollIntoViewIfNeeded()
  await field.getByText('First line.').click()
  await expect(field.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
  await canvasFocusSettled(page)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  // The body's save is held on its way while the delete lands.
  const held: Route[] = []
  await page.route('**/_serverFn/**', (route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('"ops"') ? void held.push(route) : route.continue()))
  await page.keyboard.type(' Kept words.')
  await expect.poll(() => held.length).toBeGreaterThan(0)
  await bpMutate([{delete: {id: POST, type: 'post', force: true}}])
  const banner = page.getByRole('alert').filter({hasText: 'This document has been deleted.'})
  await expect(banner).toContainText('Your unsaved edits from', {timeout: 15_000})
  for (const r of held.splice(0)) await r.continue()
  await page.unroute('**/_serverFn/**')
  await banner.getByRole('button', {name: 'Restore most recent revision'}).click()
  const offer = page.locator('[data-kept-words]')
  await expect(offer).toContainText('Words were not saved:', {timeout: 20_000})
  await offer.getByRole('button', {name: 'Put the words back'}).click()
  await offer.getByRole('button', {name: 'Confirm: replace this text with the kept words'}).click()
  const text = async () => JSON.stringify(await t.docValue(POST, 'body'))
  await expect.poll(text, {timeout: 15_000}).toContain('First line. Kept words.')
})
