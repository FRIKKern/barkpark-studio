import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J26, Sanity's focus mode, on both sides (nothing is written). The document pane's
// button hides the navigation (the list panes) and the URL stays; the title line becomes
// a breadcrumb; the button brings the panes back; a breadcrumb goes back to its pane.
test('J26: focus mode hides the navigation, keeps the URL, and leaves by its button or a breadcrumb', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', 'post-05'))
  await signInIfAsked(page)
  await t.settle(page)
  const list = page.getByPlaceholder('Search list')
  await expect(list).toBeVisible()
  const url = page.url()
  await page.getByRole('button', {name: 'Enter focus mode (hide navigation)'}).click()
  await expect(list).toBeHidden()
  expect(page.url()).toBe(url)
  const crumbs = page.getByRole('button', {name: 'Post', exact: true})
  await expect(crumbs).toBeVisible()
  await expect(page.getByRole('button', {name: 'Exit focus mode (show navigation)'})).toBeFocused()
  await page.getByRole('button', {name: 'Exit focus mode (show navigation)'}).click()
  await expect(list).toBeVisible()
  expect(page.url()).toBe(url)
  // Again, and out by the breadcrumb: the post list, the document closed.
  await page.getByRole('button', {name: 'Enter focus mode (hide navigation)'}).click()
  await crumbs.click()
  await expect(list).toBeVisible()
  await expect(page).toHaveURL(/\/structure\/post$/)
})
