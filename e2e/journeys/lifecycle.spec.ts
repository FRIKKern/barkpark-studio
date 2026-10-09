import {expect, test, type Page} from '@playwright/test'
import {target, type Target, BACKEND_POLL} from '../rig/targets'

// J03 + J04 + J13, both studios, three tests on three docs (QUALITY.md rule 5: each
// under 5 s, and three tests spread over the CI shards). J03: typing is local-first —
// fast typing never drops a keystroke (a controlled input re-rendered from a stale
// cache does exactly that, silently), undo/redo work, the edit survives a reload.
// J04: edit → draft, publish, discard, unpublish, each checked against the
// backend's own versions, not just the screen. J13 rides on J04's discarded edit:
// rules from the schema, checked as you type; publish blocked until they pass; the
// Validation panel lists them.
const ID = 'post-15'
const TITLE = 'Fixture post 15'
const TYPED = `${TITLE} the quick brown fox`
const CHECKED = 'post-28' // J13 + discard
const UNPUBLISHED = 'post-30' // unpublish

// The confirm button inside the dialog (both studios also have a same-named footer button).
const confirm = (page: Page, name: RegExp) => page.getByRole('dialog').filter({has: page.getByRole('button', {name})}).getByRole('button', {name}).last()
async function docMenuItem(t: Target, page: Page, name: RegExp) {
  await t.docMenu(page).click()
  await page.getByRole('menuitem', {name}).click()
}

test.afterEach(async ({}, info) => {
  for (const id of [ID, CHECKED, UNPUBLISHED]) await target(info).resetDoc(id, 'post')
})

test('J03 J04: type without drops, undo, a draft beside the published version, reload, publish', async ({page}, info) => {
  const t = target(info)
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
  await expect.poll(versions, BACKEND_POLL).toEqual({draft: TYPED, published: TITLE})
  await page.reload()
  await t.settle(page)
  await expect(title).toHaveValue(TYPED)

  // Publish → one version again, the new one.
  await page.getByRole('button', {name: /^Publish$/}).last().click()
  await expect.poll(versions, BACKEND_POLL).toEqual({draft: undefined, published: TYPED})
})

test('J13 J04: validation as you type blocks publish (errors only); discard', async ({page}, info) => {
  const t = target(info)
  const C_TITLE = 'Fixture post 28'
  await t.prepare(page.context())
  await page.goto(t.docPath('post', CHECKED))
  await t.settle(page)
  const title = t.field(page, 'title')
  const versions = () => t.versions(CHECKED)
  const publish = page.getByRole('button', {name: /^Publish$/}).last()
  await expect(title).toHaveValue(C_TITLE)
  // J13: the required title emptied, a rating over its max (Meta) → publish blocked,
  // both listed; fixed → publish comes back. J04 then discards the edit.
  await title.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect(publish).toBeDisabled()
  await page.getByRole('tab', {name: 'Meta'}).click()
  await t.field(page, 'rating').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('9')
  await page.getByRole('button', {name: 'Validation'}).click()
  await expect(page.getByText('Must be lower than or equal to 5').filter({visible: true}).first()).toBeVisible()
  await expect(page.getByText('Required', {exact: true}).filter({visible: true}).first()).toBeVisible()
  await t.field(page, 'rating').fill('3')
  await page.getByRole('tab', {name: 'Content'}).click()
  await title.fill(`${C_TITLE} oops`)
  await expect(publish).toBeEnabled({timeout: 10_000})
  // A warning is listed but never blocks publishing (J13 levels).
  await t.field(page, 'excerpt').fill('x'.repeat(170))
  await expect(page.getByText('Long excerpts get cut off in previews').filter({visible: true}).first()).toBeVisible()
  await expect(publish).toBeEnabled({timeout: 10_000})
  // So is info, and the backend holds it (Barkpark refused it like an error before #22125).
  await page.getByRole('tab', {name: 'Meta'}).click()
  await page.getByText(/^(SEO|Seo)$/).first().click() // collapsed by default
  await t.field(page, 'seo.metaDescription').fill('Too short')
  await expect(page.getByText('Search results show about 150 characters').filter({visible: true}).first()).toBeVisible()
  await expect.poll(async () => ((await t.docValue(CHECKED, 'seo')) as {metaDescription?: string} | undefined)?.metaDescription, BACKEND_POLL).toBe('Too short')
  await expect(publish).toBeEnabled({timeout: 10_000})
  // An array's length (tags: max 3, a warning): Sanity checks it as you type; ours shows
  // Barkpark's advisory from the save (#22406, #22425), in the same words. Never blocks.
  await t.field(page, 'tags').click()
  for (const tag of ['three', 'four']) (await page.keyboard.type(tag), await page.keyboard.press('Enter'))
  await expect(page.getByText('Must have at most 3 items').filter({visible: true}).first()).toBeVisible({timeout: 10_000})
  if (process.env.EVIDENCE) await page.screenshot({path: `evidence/J13-${t.name}-tags-warning.png`})
  await expect(publish).toBeEnabled({timeout: 10_000})
  await page.getByRole('tab', {name: 'Content'}).click()

  // Edit, then discard → back to what is published.
  await expect.poll(versions, BACKEND_POLL).toEqual({draft: `${C_TITLE} oops`, published: C_TITLE})
  await docMenuItem(t, page, /Discard changes/)
  await confirm(page, /^Discard changes$/).click()
  await expect.poll(versions, BACKEND_POLL).toEqual({draft: undefined, published: C_TITLE})
  await expect(title).toHaveValue(C_TITLE)

})

test('J04: unpublish from the published perspective leaves only a draft', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  const versions = () => t.versions(UNPUBLISHED)
  // Unpublish (from the Published perspective) → only a draft is left.
  await page.goto(`${t.docPath('post', UNPUBLISHED)}?perspective=published`)
  await t.settle(page)
  await page.getByRole('button', {name: /^Unpublish$/}).last().click()
  await confirm(page, /^Unpublish( now)?$/).click()
  await expect.poll(versions, BACKEND_POLL).toEqual({draft: 'Fixture post 30', published: undefined})
})
