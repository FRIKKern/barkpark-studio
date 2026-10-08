import {expect, test, type Locator, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target} from '../rig/targets'

// J16 evidence, both studios, on post-history: a document with a real history on
// each side (scripts/reference-history.mjs: edits by two authors, publishes, an
// unpublish — fixture imports rewrite history, so it isn't in the seed). Open
// History from the "…" menu; pick a published revision: it shows
// read-only at a deep URL that survives a reload; Revert to revision writes it
// back as the draft. Stills + clips go to e2e/evidence/. Not a CI gate.
// Re-run scripts/reference-history.mjs after (the revert leaves a draft).
// Authors by name on ours need dev sign-in (STUDIO_DEV_LOGIN=1 + an admin token);
// without it every author is "API token" (task-d0c6a847e2a4658e).
const ID = 'post-history'
const FIRST = 'History fixture v4'
const shot = (name: string, step: string) => `evidence/J16-${name}-${step}.png`
test.use({video: 'on'})

async function openMenu(t: Target, page: Page, button: Locator) {
  const id = t.name === 'sanity' ? await button.first().getAttribute('id') : null
  await button.first().click()
  if (!id) return page.getByRole('menu')
  await page.waitForTimeout(300)
  return page.locator(`[role=menu][aria-labelledby="${id}"]`)
}
const docMenu = (t: Target, page: Page) =>
  t.name === 'sanity' ? t.pane(page, 2).locator('button:has([data-sanity-icon="ellipsis-horizontal"])').first() : page.getByRole('button', {name: 'Show document actions'})

async function retitle(t: Target, page: Page, title: string) {
  await t.field(page, 'title').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(title)
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toMatchObject({draft: title})
}

test('@evidence J16: history timeline, an old revision read-only, revert', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)

  // Two more versions, made here in each studio: Sanity's timeline only resolves
  // revisions for edits it has indexed, and the newest are the reliable ones.
  await retitle(t, page, FIRST)
  await page.getByRole('button', {name: /^Publish$/}).last().click()
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toEqual({draft: undefined, published: FIRST})
  await retitle(t, page, 'History fixture v5')

  // History, from the document "…" menu.
  await (await openMenu(t, page, docMenu(t, page))).getByRole('menuitem', {name: 'History'}).click()
  // Sanity's timeline is a listbox of options holding buttons; ours a list of buttons
  // (the same rows without axe's nested-interactive, F13).
  const revisions = t.name === 'sanity' ? page.getByRole('listbox', {name: 'Document revisions'}) : page.getByRole('list', {name: 'Document revisions'})
  const entry = (name?: RegExp) => (t.name === 'sanity' ? revisions.getByRole('option', {name}).first().getByRole('button').first() : revisions.getByRole('button', {name}).first())
  await expect(entry()).toBeVisible()
  await expect(entry(/Published/)).toBeVisible({timeout: 15_000})
  await page.screenshot({path: shot(t.name, '1-timeline')})

  // The published v4: read-only, at a deep URL.
  await entry(/Published/).click()
  await expect(t.field(page, 'title')).toHaveValue(FIRST, {timeout: 15_000})
  await expect.poll(() => decodeURIComponent(page.url())).toMatch(/rev=[0-9a-f-]+/)
  const deepUrl = page.url()
  await page.screenshot({path: shot(t.name, '2-old-revision')})
  // The deep URL survives a reload on ours. The reference can only show a revision
  // in the session that loaded its timeline: after a reload the form is empty (seen
  // on a fresh doc too, 2026-10-06), so there the revert runs first and the
  // reload's still comes last.
  if (t.name === 'studio') {
    await page.goto(deepUrl)
    await t.settle(page)
    await expect(t.field(page, 'title')).toHaveValue(FIRST, {timeout: 15_000})
    await page.screenshot({path: shot(t.name, '2b-reloaded')})
  }

  // Revert to revision: both ask "Are you sure you want to restore this document?",
  // then the old revision becomes the draft.
  await page.getByRole('button', {name: 'Revert to revision'}).last().click()
  await expect(page.getByText('Are you sure you want to restore this document?')).toBeVisible()
  await page.waitForTimeout(t.name === 'sanity' ? 500 : 0) // its popover animates in
  await page.screenshot({path: shot(t.name, '2c-revert-confirm')})
  await page
    .getByText('Are you sure you want to restore this document?')
    .locator('xpath=ancestor::*[.//button[normalize-space()="Confirm"]][1]')
    .getByRole('button', {name: 'Confirm'})
    .click()
  if (t.name === 'sanity') {
    // On this project the reference's restore fails ("An error occurred during
    // restore"): its history API doesn't return the revision (2026-10-06). Keep the still.
    await page.waitForTimeout(3000)
    await page.screenshot({path: shot(t.name, '3-restored')})
    console.log(`[J16 sanity] after revert: ${JSON.stringify(await t.versions(ID))}`)
  } else {
    await expect.poll(() => t.versions(ID), {timeout: 10_000}).toMatchObject({draft: FIRST})
    await page.screenshot({path: shot(t.name, '3-restored')})
  }

  if (t.name === 'sanity') {
    await page.goto(deepUrl)
    await t.settle(page)
    await page.waitForTimeout(4000)
    await page.screenshot({path: shot(t.name, '2b-reloaded')})
  }
})
