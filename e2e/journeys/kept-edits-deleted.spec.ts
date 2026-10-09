import {expect, test, type Route} from '@playwright/test'
import {bpMutate, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// J32 widen (task-6612fd882f8b8b63): someone deletes the doc while you type. The save
// that was on its way meets the delete (404); every keystroke is kept, the deleted
// banner says so, and Restore brings the doc back with them on top. Ours only: Sanity
// loses them.
const ID = 'author-kept-at-delete'
test.setTimeout(60_000)

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio') await bpMutate([{delete: {id: ID, type: 'author', force: true}}]).catch(() => {})
})

test('keystrokes typed as the doc is deleted come back with Restore', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity loses them')
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
