import {expect, test} from '@playwright/test'
import {target, BACKEND_POLL} from '../rig/targets'
import {referenceHold} from '../rig/reference'

// J19, keyboard only on both studios: global search → open → edit → publish.
// Proof of publish is the backend's published document, not the UI.
const ID = 'post-12'
const TITLE = 'Fixture post 12'

test.afterEach(async ({}, info) => target(info).restore(ID, {title: TITLE}))

test('J19: search recovery and visible keyboard selection', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'Candidate failure and scrolling regression; reference comparison is recorded separately')
  await page.setViewportSize({width: 1440, height: 450})
  await t.prepare(page.context())
  await page.goto('/structure')
  await t.settle(page)
  await page.keyboard.press('ControlOrMeta+k')
  if (t.name === 'studio') {
    await page.route('**/_serverFn/**', (route) => route.request().method() === 'GET' ? route.abort('failed') : route.continue())
    await page.keyboard.type('j19x')
    await expect(page.getByRole('alert')).toContainText('Could not fetch search results')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/structure$/)
    await page.unroute('**/_serverFn/**')
    const retry = page.getByRole('button', {name: 'Retry search'})
    for (let i = 0; i < 6 && !(await retry.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(retry).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', {name: 'Search'}).getByText('No results found')).toBeVisible()
    await expect(page.getByRole('combobox')).toBeFocused()
    await page.keyboard.press('ControlOrMeta+a')
    // A short window reaches clipped rows with fewer key round-trips.
    await page.keyboard.type('Fixture post')
    // Every "Fixture …" doc matches (Sanity ORs the words); posts match both words in the title, so they lead.
    const options = page.getByRole('option')
    await expect(options.nth(30)).toBeAttached()
    await expect(options.nth(29)).toContainText('Fixture post')
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
    await expect.poll(() => page.getByRole('option', {selected: true}).evaluate((el) => {
      const row = el.getBoundingClientRect()
      const list = el.closest('[role="listbox"]')!.getBoundingClientRect()
      return row.top >= list.top && row.bottom <= list.bottom
    })).toBe(true)
    await expect(page.getByRole('combobox')).toBeFocused()
  }
})

test('J19: keyboard only — search, open, edit, publish', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto('/structure')
  await t.settle(page)
  await referenceHold(page, page.getByRole('link', {name: 'Post', exact: true}))
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('post 12')
  await expect(page.getByText('Fixture post 12', {exact: true}).first()).toBeVisible()
  if (t.name === 'sanity') await page.waitForTimeout(1500) // its results settle after a refetch
  await referenceHold(page, page.getByText('Fixture post 12', {exact: true}).first())
  await page.keyboard.press('Enter') // the first result is active in both studios
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(`/structure/post;${ID}`)
  await referenceHold(page, t.field(page, 'title'), TITLE)

  // Sanity now focuses its field-group tabs; the title is reachable by Tab
  // (four presses in the 7 October reference). Ours focuses the title directly.
  if (t.name === 'sanity') {
    for (let i = 0; i < 12 && !(await t.field(page, 'title').evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  }
  await expect(t.field(page, 'title')).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.type(' kb')
  await referenceHold(page, t.field(page, 'title'), `${TITLE} kb`)
  if (t.name === 'sanity') {
    await expect.poll(() => t.docValue(ID, 'title'), BACKEND_POLL).toBe(`${TITLE} kb`)
    await expect(page.getByRole('button', {name: 'Publish', exact: true})).toBeEnabled()
  }
  await page.keyboard.press('Control+Alt+p')

  await expect.poll(() => t.publishedTitle(ID), BACKEND_POLL).toBe(`${TITLE} kb`)
  await expect(t.field(page, 'title'), 'F6: focus stays in the field').toBeFocused()
  await referenceHold(page, t.field(page, 'title'), `${TITLE} kb`)
})
