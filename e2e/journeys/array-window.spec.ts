import {expect, test} from '@playwright/test'
import {BACKEND_POLL, closeAndSettle, signInIfAsked, target} from '../rig/targets'

// A long array (over 150 items) draws only the rows near the view (SortableRows). What
// must still work: a row moved far by keyboard keeps focus and lands where it went; a
// deep link to a far item opens it. Ours only: Sanity's is the reference for the window.
const ID = `post-window-${Date.now().toString(36)}`
const N = 400
const links = Array.from({length: N}, (_, i) => ({_key: `w${i}`, _type: 'link', kind: 'externalLink', title: `Row ${String(i).padStart(3, '0')}`, url: `https://example.com/${i}`}))

test.beforeEach(({}, info) => test.skip(target(info).name === 'sanity', "ours: Sanity's array is the reference"))
test.afterEach(async ({page}, info) => (await closeAndSettle(page), await target(info).deleteDoc(ID, 'post')))

test('@local a long array: a row moved 60 places by keyboard keeps focus; a deep link opens a far item', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(ID, 'post', {title: 'Window probe', slug: {_type: 'slug', current: ID}, links}), t.prepare(page.context())])
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  await page.locator('#links').evaluate((el) => el.scrollIntoView())
  // Only the rows near the view are drawn.
  expect(await page.locator('#links .array-row').count()).toBeLessThan(100)

  const handle = page.locator('#links .array-row').filter({hasText: 'Row 005'}).locator('.drag-handle')
  await handle.focus()
  await page.keyboard.press('Space')
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown')
  await expect(page.locator(':focus')).toHaveClass(/drag-handle/)
  await page.keyboard.press('Space')
  await expect(page.locator('#links .array-row').filter({has: page.locator(':focus')})).toContainText('Row 005')
  await expect.poll(async () => ((await t.docValue(ID, 'links')) as {_key: string}[]).findIndex((l) => l._key === 'w5'), BACKEND_POLL).toBe(65)

  await page.goto(`${t.docPath('post', ID)},path=${encodeURIComponent('links[_key=="w390"].title')}`)
  await expect(page.getByRole('dialog').last().getByRole('textbox', {name: 'Title'})).toHaveValue('Row 390')
})
