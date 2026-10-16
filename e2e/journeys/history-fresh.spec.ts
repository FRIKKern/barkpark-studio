import {expect, test} from '@playwright/test'
import {closeAndSettle, signInIfAsked, target} from '../rig/targets'

// J16: History opened right after a publish. The doc footer reads the history for "Last
// published …" and stops while you type, so the cached rows could predate the publish;
// the panel listed them, then re-drew when its fresh read landed, and a click meant for
// the new "Published" opened the old one (sign-off pack, 2026-10-11). Reads are held back
// from the publish on, so the fresh one lands well after the panel opens.
const ID = 'post-18'
const TITLE = 'Fixture post 18'
const NEW = `${TITLE} j16`

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  await target(info).restore(ID, {title: TITLE})
})

// @local: about 8 s (the held reads), over rule 5's 5 s.
test('@local J16: History right after a publish lists that publish; no stale rows to click', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the footer that keeps the history cached is ours')
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await expect(page.locator('.doc-footer .save-state')).toContainText('Last published')
  await page.waitForTimeout(500) // the footer's read: rows up to the seed's publish
  await t.field(page, 'title').fill(NEW)
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toMatchObject({draft: NEW})
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  await page.getByRole('button', {name: /^Publish$/}).last().click()
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toEqual({draft: undefined, published: NEW})
  // Typing on at once: the footer stops reading before its re-read after the publish.
  await t.field(page, 'title').fill(`${NEW} v5`)

  await page.getByRole('button', {name: 'Show document actions'}).click()
  await page.getByRole('menuitem', {name: 'History'}).click()
  await page.getByRole('list', {name: 'Document revisions'}).getByRole('button').filter({hasText: 'Published'}).first().click()
  await expect(t.field(page, 'title')).toHaveValue(NEW)
})

// Sanity's footer status ("Last published …") is a button: it opens History on Review changes.
test('J15: the footer status opens Review changes', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours (Sanity is the scout reference)')
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.locator('.doc-footer').getByRole('button', {name: /Last published/}).click()
  await expect(page).toHaveURL(/changesInspectorTab=review/)
  await expect(page.getByRole('tab', {name: 'Review changes'})).toHaveAttribute('aria-selected', 'true')
  // The inspector takes a third of the document pane, as Sanity's: 345 px at 1440, 320 at 1024.
  const inspector = page.getByRole('complementary', {name: 'History'})
  const width = async () => Math.round((await inspector.boundingBox())!.width)
  await expect.poll(width).toBeGreaterThan(340)
  await page.setViewportSize({width: 1024, height: 900})
  await expect.poll(width).toBe(320)
})
