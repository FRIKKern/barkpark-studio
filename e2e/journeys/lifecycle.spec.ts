import {expect, test, type Page} from '@playwright/test'
import {target, type Target} from '../rig/targets'

// J03 + J04, both studios, one doc, one page load. J03: typing is local-first —
// fast typing never drops a keystroke (a controlled input re-rendered from a stale
// cache does exactly that, silently), undo/redo work, the edit survives a reload.
// J04: edit → draft, publish, discard, unpublish, each checked against the
// backend's own versions, not just the screen.
const ID = 'post-15'
const TITLE = 'Fixture post 15'
const TYPED = `${TITLE} the quick brown fox`

// The confirm button inside the dialog (both studios also have a same-named footer button).
const confirm = (page: Page, name: RegExp) => page.getByRole('dialog').filter({has: page.getByRole('button', {name})}).getByRole('button', {name}).last()
async function docMenuItem(t: Target, page: Page, name: RegExp) {
  await t.docMenu(page).click()
  await page.getByRole('menuitem', {name}).click()
}

test.afterEach(async ({}, info) => target(info).resetDoc(ID, 'post'))

test('J03 J04: type without drops, undo, draft, publish, discard, unpublish', async ({page}, info) => {
  const t = target(info)
  test.setTimeout(45_000)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const title = t.field(page, 'title')
  const versions = () => t.versions(ID)
  await expect(title).toHaveValue(TITLE)

  // J03: no dropped keys at full speed, then undo and redo.
  await title.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' the quick brown fox', {delay: 0})
  await expect(title).toHaveValue(TYPED)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(title).not.toHaveValue(TYPED)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(title).toHaveValue(TYPED)

  // J04: the edit is a draft next to the published version; J03: it survives a reload.
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: TYPED, published: TITLE})
  await page.reload()
  await t.settle(page)
  await expect(title).toHaveValue(TYPED)

  // Publish → one version again, the new one.
  await page.getByRole('button', {name: /^Publish$/}).last().click()
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: undefined, published: TYPED})

  // Edit, then discard → back to what is published.
  await title.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' oops')
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: `${TYPED} oops`, published: TYPED})
  await docMenuItem(t, page, /Discard changes/)
  await confirm(page, /^Discard changes$/).click()
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: undefined, published: TYPED})
  await expect(title).toHaveValue(TYPED)

  // Unpublish (from the Published perspective) → only a draft is left.
  await page.goto(`${t.docPath('post', ID)}?perspective=published`)
  await t.settle(page)
  await page.getByRole('button', {name: /^Unpublish$/}).last().click()
  await confirm(page, /^Unpublish( now)?$/).click()
  await expect.poll(versions, {timeout: 10_000}).toEqual({draft: TYPED, published: undefined})
})
