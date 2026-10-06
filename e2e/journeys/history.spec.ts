import {expect, test, type Locator, type Page} from '@playwright/test'
import {target, type Target} from '../rig/targets'

// J16 evidence, both studios: edit and publish, edit again; open History from
// the document "…" menu; pick the published revision: it shows read-only at a
// deep URL that survives a reload; Revert to revision writes it back as the draft. Stills +
// clips go to e2e/evidence/ (gitignored). Not a CI gate (`pnpm evidence`).
// Authors by name on ours need dev sign-in (STUDIO_DEV_LOGIN=1 + an admin token);
// without it every author is "API token" (task-d0c6a847e2a4658e).
const ID = 'post-16'
const TITLE = 'Fixture post 16'
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

async function signInIfAsked(page: Page) {
  if (!page.url().includes('/login')) return
  await page.locator('html[data-hydrated]').waitFor({state: 'attached'}) // typing before hydration is lost
  await page.locator('#email').fill('studio-editor-a@example.com')
  await page.getByRole('button', {name: 'Sign in'}).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

async function retitle(t: Target, page: Page, title: string) {
  await t.field(page, 'title').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(title)
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toMatchObject({draft: title})
}

test.afterEach(async ({}, info) => target(info).restore(ID, {title: TITLE}))

test('@evidence J16: history timeline, an old revision read-only, revert', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)

  // Two versions to go back to: v1 published, then v2 as the draft.
  await retitle(t, page, 'Post 16 v1')
  await page.getByRole('button', {name: /^Publish$/}).last().click()
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toEqual({draft: undefined, published: 'Post 16 v1'})
  await retitle(t, page, 'Post 16 v2')

  // History, from the document "…" menu.
  await (await openMenu(t, page, docMenu(t, page))).getByRole('menuitem', {name: 'History'}).click()
  const revisions = page.getByRole('listbox', {name: 'Document revisions'})
  await expect(revisions.getByRole('option').first()).toBeVisible()
  await expect(revisions.getByRole('option', {name: /Published/}).first()).toBeVisible({timeout: 15_000})
  await page.screenshot({path: shot(t.name, '1-timeline')})

  // The published revision: read-only, at a deep URL.
  await revisions.getByRole('option', {name: /Published/}).first().getByRole('button').first().click()
  await expect(t.field(page, 'title')).toHaveValue('Post 16 v1')
  await expect.poll(() => decodeURIComponent(page.url())).toMatch(/rev=[0-9a-f-]+/)
  const deepUrl = page.url()
  await page.screenshot({path: shot(t.name, '2-old-revision')})
  // The deep URL survives a reload on ours. Sanity's reference answers "We couldn't
  // find the document revision selected" after a reload (observed 2026-10-06), so
  // there the revert runs straight from the timeline pick.
  if (t.name === 'studio') {
    await page.goto(deepUrl)
    await t.settle(page)
    await expect(t.field(page, 'title')).toHaveValue('Post 16 v1', {timeout: 15_000})
    await page.screenshot({path: shot(t.name, '2b-reloaded')})
  }

  // Revert to revision: the old revision becomes the draft.
  await page.getByRole('button', {name: 'Revert to revision'}).last().click()
  // Both ask first: "Are you sure you want to restore this document?"
  await expect(page.getByText('Are you sure you want to restore this document?')).toBeVisible()
  await page.waitForTimeout(t.name === 'sanity' ? 500 : 0) // its popover animates in
  await page.screenshot({path: shot(t.name, '2c-revert-confirm')})
  await page
    .getByText('Are you sure you want to restore this document?')
    .locator('xpath=ancestor::*[.//button[normalize-space()="Confirm"]][1]')
    .getByRole('button', {name: 'Confirm'})
    .click()
  if (t.name === 'sanity') {
    // The reference answers "An error occurred during restore" on this dataset
    // (observed 2026-10-06; its history was rewritten by fixture imports). Keep the still.
    await page.waitForTimeout(3000)
    await page.screenshot({path: shot(t.name, '3-restored')})
    return
  }
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toMatchObject({draft: 'Post 16 v1'})
  await page.screenshot({path: shot(t.name, '3-restored')})
})
