import {expect, test, type Page} from '@playwright/test'
import {target, type Target} from '../rig/targets'

// J04, both studios: edit → draft, publish, discard, unpublish. Every step is
// checked against the backend's own versions, not just the screen.
const ID = 'post-15'
const TITLE = 'Fixture post 15'

// The confirm button inside the dialog (both studios also have a same-named footer button).
const confirm = (page: Page, name: RegExp) => page.getByRole('dialog').filter({has: page.getByRole('button', {name})}).getByRole('button', {name}).last()
async function docMenuItem(t: Target, page: Page, name: RegExp) {
  await t.docMenu(page).click()
  await page.getByRole('menuitem', {name}).click()
}

test.afterEach(async ({}, info) => target(info).resetDoc(ID, 'post'))

test('J04: draft lifecycle — edit, publish, discard, unpublish', async ({page}, info) => {
  const t = target(info)
  test.setTimeout(45_000)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const title = t.field(page, 'title')
  const versions = () => t.versions(ID)

  // Edit → a draft appears next to the published version.
  await title.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' v2')
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: `${TITLE} v2`, published: TITLE})

  // Publish → one version again, the new one.
  await page.getByRole('button', {name: /^Publish$/}).last().click()
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: undefined, published: `${TITLE} v2`})

  // Edit, then discard → back to what is published.
  await title.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' oops')
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: `${TITLE} v2 oops`, published: `${TITLE} v2`})
  await docMenuItem(t, page, /Discard changes/)
  await confirm(page, /^Discard changes$/).click()
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: undefined, published: `${TITLE} v2`})
  await expect(title).toHaveValue(`${TITLE} v2`)

  // Unpublish (from the Published perspective) → only a draft is left.
  await page.goto(`${t.docPath('post', ID)}?perspective=published`)
  await t.settle(page)
  await page.getByRole('button', {name: /^Unpublish$/}).last().click()
  await confirm(page, /^Unpublish( now)?$/).click()
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: `${TITLE} v2`, published: undefined})
})
