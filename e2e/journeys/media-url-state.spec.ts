import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// B08 (task-4c538c9fb64e9843): the Media tool's kind, search, sort and view live in the URL,
// so another tool and Back, a reload, or the link itself bring them back, as Vision keeps
// its query. Nothing is written.
test('B08: Media keeps its kind, search, sort and view across Back and a reload', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: Sanity has no Media tool')
  await page.goto('/media')
  await signInIfAsked(page)
  await t.settle(page)
  const kinds = page.getByRole('navigation', {name: 'Library'})
  const searchbox = page.getByRole('searchbox', {name: 'Search media'})
  const sort = page.getByRole('combobox', {name: 'Sort'})
  const list = page.getByRole('button', {name: 'List', exact: true})
  await kinds.getByRole('button', {name: /^Images/}).click()
  await searchbox.fill('fixture')
  // LiveView's: a search sorts by Best match until another order is picked.
  await expect(sort).toHaveValue('relevance')
  await sort.selectOption('created-asc')
  await list.click()
  await expect(page).toHaveURL(/[?&]kind=image/)
  await expect(page).toHaveURL(/[?&]q=fixture/)
  await expect(page).toHaveURL(/[?&]sort=created-asc/)
  await expect(page).toHaveURL(/[?&]view=list/)
  const kept = async () => {
    await expect(kinds.getByRole('button', {name: /^Images/})).toHaveAttribute('aria-current', 'true')
    await expect(searchbox).toHaveValue('fixture')
    await expect(sort).toHaveValue('created-asc')
    await expect(list).toHaveAttribute('aria-pressed', 'true')
  }
  await page.getByRole('link', {name: 'Structure', exact: true}).click()
  await expect(page).toHaveURL(/\/structure/)
  await page.goBack()
  await kept()
  await page.reload()
  await t.settle(page)
  await kept()
})
