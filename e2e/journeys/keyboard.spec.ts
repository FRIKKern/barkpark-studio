import {expect, test} from '@playwright/test'
import {target, BACKEND_POLL} from '../rig/targets'
import {referenceHold} from '../rig/reference'

// J19, keyboard only on both studios: global search → open → edit → publish.
// Proof of publish is the backend's published document, not the UI.
const ID = 'post-12'
const TITLE = 'Fixture post 12'

test.afterEach(async ({}, info) => target(info).restore(ID, {title: TITLE}))

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

  // Ours puts the caret in the doc's first field. Sanity leaves focus on <body> and
  // 80 Tab presses did not reach the title (measured 2026-10-05): the keyboard-only
  // journey stops there in the reference, so the rest runs on ours only.
  test.skip(t.name === 'sanity', 'Sanity: focus on <body> after opening from search; Tab does not reach the title')
  await expect(t.field(page, 'title')).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.type(' kb')
  await referenceHold(page, t.field(page, 'title'), `${TITLE} kb`)
  await page.keyboard.press('Control+Alt+p')

  await expect.poll(() => t.publishedTitle(ID), BACKEND_POLL).toBe(`${TITLE} kb`)
  await expect(t.field(page, 'title'), 'F6: focus stays in the field').toBeFocused()
  await referenceHold(page, t.field(page, 'title'), `${TITLE} kb`)
})
