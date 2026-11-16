import {expect, test, type Route} from '../rig/test'
import {bpMutate, bpRemove, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// J32 widen (task-6612fd882f8b8b63): someone deletes the doc while you type. The save
// that was on its way meets the delete (404); every keystroke is kept, the deleted
// banner says so, and Restore brings the doc back with them on top. Ours only: Sanity
// loses them. Restore against a newer version: kept-edits-restore.spec; the body:
// kept-edits-deleted-body.spec (split for CI's shards, task-c1df532bed870536).
const ID = 'author-kept-at-delete'
test.setTimeout(60_000)

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  // Confirmed gone (bpRemove): a swallowed delete left drafts that other journeys' lists then
  // counted (task-207df0ed3ed446bf: panes J01 counted one post too many).
  if (target(info).name === 'studio') await bpRemove(ID, 'author')
})

for (const frames of ['live', 'no live frame'] as const)
test(`keystrokes typed as the doc is deleted come back with Restore (${frames})`, async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity loses them')
  // CI once missed the delete's live frame and the pane never turned (de6987a, ci-4): the
  // save's 404 alone must show the deleted banner.
  if (frames !== 'live') await page.route('**/api/stream**', (route) => route.abort('failed')) // the tab's one stream (lib/stream.ts)
  // The author is made while the browser gets ready (as refs.spec, #935).
  await Promise.all([t.prepare(page.context()), bpMutate([{createOrReplace: {_id: ID, _type: 'author', title: 'Kept Author', name: 'Kept Author'}}, {publish: {id: ID, type: 'author'}}])])
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
  await expect.poll(() => held.length, {intervals: [50]}).toBeGreaterThan(0)
  await bpMutate([{delete: {id: ID, type: 'author', force: true}}])
  for (const r of held.splice(0)) await r.continue()
  await page.unroute('**/_serverFn/**')
  const banner = page.getByRole('alert').filter({hasText: 'This document has been deleted.'})
  await expect(banner).toContainText('Your unsaved edits from', {timeout: 15_000})
  await page.screenshot({path: 'evidence/J32-kept-edits-deleted.png'})
  // The pane stays, as Sanity's: "Untitled", the form empty and read-only, Published off.
  await expect(page.locator('.title-row')).toHaveText('Untitled')
  await expect(t.field(page, 'name')).toHaveValue('')
  await expect(t.field(page, 'name')).toBeDisabled()
  await expect(page.locator('.pane-header .chip[data-off]')).toHaveText('Published')
  await banner.getByRole('button', {name: 'Restore most recent revision'}).click()
  await expect(t.field(page, 'name')).toHaveValue('Kept Author typed', {timeout: 15_000})
  await expect.poll(() => t.docValue(ID, 'name', 'author'), {timeout: 15_000}).toBe('Kept Author typed')
})
