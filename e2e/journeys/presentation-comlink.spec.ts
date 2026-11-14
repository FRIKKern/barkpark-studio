import {expect, test} from '../rig/test'
import {closeAndSettle, signInIfAsked, target} from '../rig/targets'

// A next-sanity site in our Presentation: it speaks Sanity's comlink (<VisualEditing>,
// useLiveMode), not our bridge, and holds no token. The third copy of reference/preview-site
// (PREVIEW_SOURCE=sanity-on-barkpark, PREVIEW_SITE_PORT_COMLINK) stands in for the studio's
// preview origin, which the studio is built with: its requests go to that copy.
const SITE = `http://localhost:${process.env.PREVIEW_SITE_PORT_BARKPARK}` // playwright.config sets both
const COMLINK = `http://localhost:${process.env.PREVIEW_SITE_PORT_COMLINK}`

test.afterEach(async ({page}, info) => {
  if (info.project.name !== 'studio' || info.status === 'skipped') return
  await closeAndSettle(page)
  await target(info).resetDoc('post-01', 'post')
})

test('@local J59–J63 over comlink: a next-sanity page connects, a click focuses the field, typing shows live, Published and the URL follow', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity speaks comlink to its own site')
  await t.prepare(context)
  await context.route(`${SITE}/**`, (route) => route.continue({url: route.request().url().replace(SITE, COMLINK)}))
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const site = page.frameLocator('iframe')
  // The handshake and the loader channel: the page holds no token, so its heading is the
  // studio's answer to its query, and "Connecting." is gone.
  const heading = site.getByRole('heading', {level: 1})
  await expect(heading).toHaveText(/Fixture post 01/, {timeout: 20_000})
  await expect(page.locator('.presentation-frame').getByRole('status')).toBeHidden()

  // J59: Sanity's overlay sends the clicked value's document and path; its field takes focus.
  await heading.click()
  await expect(page).toHaveURL(/pane=post%3Bpost-01%2Cpath%3Dtitle/)
  const title = page.locator('.presentation-panel [id="title"]')
  await expect(title).toBeFocused()
  // A referenced document opens itself; a body paragraph opens its block.
  await site.getByText(/Body paragraph for post 1/).click()
  await expect.poll(() => page.evaluate(() => getSelection()?.focusNode?.parentElement?.closest('[data-bp-id]')?.getAttribute('data-bp-id')), {intervals: [50]}).toBe('p1')
  await site.getByText(/Alan Turing/).click()
  await expect(page).toHaveURL(/pane=author%3Bauthor-alan%2Cpath%3Dname/)
  await expect(page.locator('.presentation-panel [id="name"]')).toBeFocused()

  // J60: a typed key is on the page before its save (no reload: the frame's window is the same one).
  await heading.click()
  await expect(title).toBeFocused()
  await site.locator('body').evaluate(() => ((window as unknown as {kept: boolean}).kept = true))
  await title.press('End')
  await page.keyboard.type(' live')
  await expect(heading).toHaveText(/Fixture post 01 live/)
  await expect(title).toBeFocused()
  expect(await title.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe('Fixture post 01 live'.length)
  expect(await site.locator('body').evaluate(() => (window as unknown as {kept?: boolean}).kept)).toBe(true)

  // J63: the panel's Published chip reaches the page (its query is read as published); Draft brings the draft back.
  await page.locator('.presentation-panel').getByRole('button', {name: /^Published/}).first().click()
  await expect(heading).not.toHaveText(/live/)
  await expect(heading).toHaveText(/Fixture post 01/)
  await page.locator('.presentation-panel').getByRole('button', {name: /^Draft/}).first().click()
  await expect(heading).toHaveText(/Fixture post 01 live/)

  // J61 + the Edit switch: with the overlay off the page is a page again; its link moves the URL bar.
  await page.getByRole('switch', {name: 'Edit'}).click()
  await site.getByRole('link', {name: 'Reference site'}).click()
  await expect(page.getByLabel('URL')).toHaveValue(`${SITE}/`)
  await expect(site.getByRole('heading', {level: 1})).toHaveText('Posts')
})
