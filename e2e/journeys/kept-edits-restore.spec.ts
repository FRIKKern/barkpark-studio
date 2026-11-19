import {expect, test, type Route} from '../rig/test'
import {bpMutate, bpRemove, signInIfAsked, target, closeAndSettle, savesLanded} from '../rig/targets'

// J32 widen (task-6612fd882f8b8b63): someone deletes the doc while you type. The save
// that was on its way meets the delete (404); every keystroke is kept, the deleted
// banner says so, and Restore brings the doc back with them on top. Ours only: Sanity
// loses them. Here: Restore against a newer version (the rest of J32's widen:
// kept-edits-deleted.spec, kept-edits-deleted-body.spec).
const ID = 'author-kept-at-delete'
test.setTimeout(60_000)

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  // Confirmed gone (bpRemove): a swallowed delete left drafts that other journeys' lists then
  // counted (task-207df0ed3ed446bf: panes J01 counted one post too many).
  if (target(info).name === 'studio') await bpRemove(ID, 'author')
})

// The CI flake behind this (#446's first run, ci-5: "Kept Author", not "Kept Author typed"):
// after Restore, the kept edits were sent again made against the edited value itself, not
// the restored one (their base came from the screen, which already showed them). A change
// from Barkpark meanwhile then read as "the editor changed nothing here" and took theirs: the
// typing was lost. Here the re-sent save meets a newer rev (412) on purpose.
test('kept edits put back by Restore survive a newer version meanwhile', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only')
  // The author is made while the browser gets ready (as refs.spec, #935).
  await Promise.all([t.prepare(page.context()), bpMutate([{createOrReplace: {_id: ID, _type: 'author', title: 'Kept Author', name: 'Kept Author'}}, {publish: {id: ID, type: 'author'}}])])
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
  await expect.poll(() => held.length, {intervals: [50]}).toBeGreaterThan(0)
  await bpMutate([{delete: {id: ID, type: 'author', force: true}}])
  for (const r of held.splice(0)) await r.continue()
  const banner = page.getByRole('alert').filter({hasText: 'This document has been deleted.'})
  await expect(banner).toContainText('Your unsaved edits from', {timeout: 15_000})
  // Restore; the kept edits' save is held while Barkpark gets a newer version (same text).
  await banner.getByRole('button', {name: 'Restore most recent revision'}).click()
  await expect.poll(() => held.length, {intervals: [50], timeout: 15_000}).toBeGreaterThan(0)
  // The restore has landed on Barkpark (the kept edits' save is still held).
  await expect.poll(() => t.docValue(ID, 'name', 'author'), {timeout: 15_000}).toBe('Kept Author')
  await bpMutate([{patch: {id: ID, type: 'author', set: {bio: 'Touched meanwhile'}}}])
  // Its live frame is folded in (the form shows it) before the kept edits' save goes on.
  await expect(t.field(page, 'bio')).toHaveValue('Touched meanwhile', {timeout: 10_000})
  for (const r of held.splice(0)) await r.continue()
  await page.unrouteAll({behavior: 'wait'})
  await savesLanded(page)
  await expect.poll(() => t.docValue(ID, 'name', 'author'), {timeout: 15_000}).toBe('Kept Author typed')
  await expect(t.field(page, 'name')).toHaveValue('Kept Author typed')
})
