import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J49 evidence, ours with dev sign-in (STUDIO_DEV_LOGIN=1 + BARKPARK_ADMIN_TOKEN):
// studio-editor-d holds a read-only member token (minted for this rig). They see
// Sanity's permission banner wording, a locked form, Publish and the document
// actions disabled with the reason, and the list's "+" greyed. Editor A (read +
// write) is the control: none of that. The reference is Sanity's own wording
// (banners.permission-check-banner.*): a Sanity Viewer account isn't in this rig.
const ID = 'post-21'
const REASON = 'Your role Viewer does not have permission to edit this document.'
const shot = (step: string) => `evidence/J49-studio-${step}.png`
test.use({video: 'on'})
test.setTimeout(90_000)

test('@evidence J49: a read-only editor sees why everything is locked', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity' || process.env.STUDIO_DEV_LOGIN !== '1', 'ours, with dev sign-in')
  await t.prepare(context)

  // The control: editor A can write.
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page, 'studio-editor-a@example.com')
  await t.settle(page)
  await expect(t.field(page, 'title')).toBeEnabled()
  await expect(page.getByText(REASON)).toHaveCount(0)
  await expect(page.getByRole('button', {name: 'Create new Post'})).toBeEnabled()
  const ticks = page.getByRole('checkbox', {name: /^Select Fixture post/})
  await expect(ticks.first()).toBeVisible() // B03: rows can be ticked for bulk actions

  // Editor d: read-only.
  await context.clearCookies()
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page, 'studio-editor-d@example.com')
  await t.settle(page)
  await expect(page.getByText(REASON)).toBeVisible()
  await expect(t.field(page, 'title')).toBeDisabled()
  const publish = page.getByRole('button', {name: /^Publish$/}).last()
  await expect(publish).toBeDisabled()
  await expect(publish).toHaveAttribute('title', 'Your role Viewer does not have permission to publish this document.')
  const create = page.getByRole('button', {name: 'Create new Post'})
  await expect(create).toBeDisabled()
  await expect(create).toHaveAttribute('title', 'Your role Viewer does not have permission to create documents.')
  await expect(ticks).toHaveCount(0) // B03: nothing to bulk publish with
  await page.screenshot({path: shot('1-locked')})

  await page.getByRole('button', {name: 'Document actions'}).last().click()
  // No draft here, so no Discard (Sanity's menu since #158); the rest is disabled with the reason.
  for (const name of ['Duplicate', 'Delete']) await expect(page.getByRole('menuitem', {name})).toBeDisabled()
  await page.screenshot({path: shot('2-actions')})
  await page.keyboard.press('Escape')
  await page.getByRole('button', {name: 'Show document actions'}).click()
  await expect(page.getByRole('menuitem', {name: 'Paste document'})).toBeDisabled()
  await expect(page.getByRole('menuitem', {name: 'Copy document'})).toBeEnabled() // reading stays
  await page.keyboard.press('Escape')
})
