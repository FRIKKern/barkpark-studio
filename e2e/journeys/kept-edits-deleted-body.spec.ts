import {expect, test, type Route} from '../rig/test'
import {bpMutate, bpRemove, canvasFocusSettled, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// J32 widen (task-6612fd882f8b8b63): someone deletes the doc while you type. The save
// that was on its way meets the delete (404); every keystroke is kept, the deleted
// banner says so, and Restore brings the doc back with them on top. Ours only: Sanity
// loses them. Here: the body (the form's fields: kept-edits-deleted.spec).
const POST = 'post-kept-at-delete'
test.setTimeout(60_000)

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  // Confirmed gone (bpRemove): a swallowed delete left the post's draft, and panes J01 then
  // counted one post too many (task-207df0ed3ed446bf).
  if (target(info).name === 'studio') await bpRemove(POST, 'post')
})

// The same for the body (task-89b5c425ca8b4506): its canvas goes with the deleted form, and
// the words it had not saved went with it. Now they are kept (D21), the banner says so, and
// after Restore the body offers them back.
// @local: the same with a save on its way at Confirm (a retry of the refused batch, as on CI):
// Confirm waited for nothing, said "Finish saving your edit first" and put nothing back.
for (const race of [false, true])
test(`${race ? '@local ' : ''}body words typed as the doc is deleted are offered back after Restore${race ? ', a save on its way at Confirm' : ''}`, async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity loses them')
  const body = {blocks: [{id: 'p1', type: 'paragraph', content: [{type: 'text', value: 'First line.'}]}]}
  await Promise.all([t.prepare(page.context()), bpMutate([{createOrReplace: {_id: POST, _type: 'post', title: 'Kept body', slug: {_type: 'slug', current: POST}, body}}, {publish: {id: POST, type: 'post'}}])])
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
  await expect.poll(() => held.length, {intervals: [50]}).toBeGreaterThan(0)
  await bpMutate([{delete: {id: POST, type: 'post', force: true}}])
  const banner = page.getByRole('alert').filter({hasText: 'This document has been deleted.'})
  await expect(banner).toContainText('Your unsaved edits from', {timeout: 15_000})
  for (const r of held.splice(0)) await r.continue()
  await page.unroute('**/_serverFn/**')
  await banner.getByRole('button', {name: 'Restore most recent revision'}).click()
  const offer = page.locator('[data-kept-words]')
  await expect(offer).toContainText('Words were not saved:', {timeout: 20_000})
  await offer.getByRole('button', {name: 'Put the words back'}).click()
  if (race) {
    // A key typed in the body, its save held 1.5 s: on its way when Confirm is clicked.
    let release!: () => void
    const go = new Promise<void>((r) => (release = r))
    await page.route('**/_serverFn/**', async (route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('"ops"') ? (await go, route.continue()) : route.continue()))
    await field.locator('.ProseMirror').click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await page.waitForTimeout(400)
    setTimeout(release, 1500)
  }
  await offer.getByRole('button', {name: 'Confirm: replace this text with the kept words'}).click()
  const text = async () => JSON.stringify(await t.docValue(POST, 'body'))
  await expect.poll(text, {timeout: 15_000}).toContain('First line. Kept words.')
})
