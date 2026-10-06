import {readFileSync} from 'node:fs'
import {expect, test, type Locator, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target} from '../rig/targets'

// J36 evidence, both studios, on post-06's main image: drag a file over ("Drop
// to upload") and drop it; clear; paste one; clear; an upload that fails (the
// request is cut) and its retry; then Select from the library, a tile's "Show
// usage", and replace and remove. Sanity has no Retry (it toasts and empties
// the field, so you upload again); ours keeps the file and offers Retry.
// Stills + clips go to e2e/evidence/. Not a CI gate (it uploads).
const ID = 'post-06'
const shot = (name: string, step: string) => `evidence/J36-${name}-${step}.png`
const PNG = readFileSync(new URL('../../fixtures/assets/fixture-image.png', import.meta.url))
// A byte-different copy each time: Sanity reuses an asset whose hash it knows, which would skip the upload.
const fresh = () => Buffer.concat([PNG, Buffer.from(`${Date.now()}${Math.random()}`)])

const imageField = (t: Target, page: Page) =>
  t.name === 'sanity' ? page.locator('fieldset').filter({has: page.getByTestId('image-input')}).last() : page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
const preview = (field: Locator) => field.getByRole('img', {name: 'Preview of uploaded image'})
const uploadRoute = (t: Target) => (t.name === 'sanity' ? '**/assets/images/**' : '**/api/media/upload')

/** A DataTransfer holding one fresh PNG, in the page. */
const transfer = (page: Page) =>
  page.evaluateHandle((b64) => {
    const d = new DataTransfer()
    d.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'dropped.png', {type: 'image/png'}))
    return d
  }, fresh().toString('base64'))

async function menuItem(t: Target, page: Page, field: Locator, name: string) {
  await field.getByRole('button', {name: 'Open image options menu'}).click()
  if (t.name === 'sanity') await page.waitForTimeout(400) // its menu animates in
  await page.getByRole('menuitem', {name}).click()
}

test.use({video: 'on'})
test.setTimeout(120_000)
const clean = (t: Target) => t.restore(ID, {title: 'Fixture post 06'}, 'post', ['mainImage'])
test.beforeEach(async ({}, info) => clean(target(info)))
test.afterEach(async ({}, info) => clean(target(info)))

test('@evidence J36: drop, paste, upload error + retry, select from library + usage, replace and remove', async ({page}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => info.annotations.push({type: what, description: JSON.stringify(v)})
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Content'}).click()
  const field = imageField(t, page)
  await field.scrollIntoViewIfNeeded()
  const hint = field.getByText('Drag or paste image here')
  await expect(hint).toBeVisible()

  // 1. Drag a file over: the overlay; drop it: it uploads.
  let dt = await transfer(page)
  await hint.dispatchEvent('dragenter', {dataTransfer: dt})
  await hint.dispatchEvent('dragover', {dataTransfer: dt})
  await expect(field.getByText('Drop to upload')).toBeVisible()
  await field.screenshot({path: shot(t.name, '1-drag-over')})
  await hint.dispatchEvent('drop', {dataTransfer: dt})
  await expect(preview(field)).toBeVisible({timeout: 20_000})
  await field.screenshot({path: shot(t.name, '2-dropped')})

  // 2. Remove (Clear field), then paste one in.
  await menuItem(t, page, field, 'Clear field')
  await expect(hint).toBeVisible()
  dt = await transfer(page)
  // Paste where the keyboard is: focus the drop box first. Sanity's opens a hidden
  // paste catcher on the Ctrl/Cmd+V keydown and takes the paste there.
  const box = t.name === 'sanity' ? field.locator('[data-test-id="file-target"]').first() : field.locator('.image-empty-box')
  await box.focus()
  if (t.name === 'sanity') await page.keyboard.press('ControlOrMeta+v')
  await page.evaluate((d) => document.activeElement!.dispatchEvent(new ClipboardEvent('paste', {clipboardData: d, bubbles: true, cancelable: true})), dt)
  await expect(preview(field)).toBeVisible({timeout: 20_000})
  note('paste', 'uploaded')
  await menuItem(t, page, field, 'Clear field')
  await expect(hint).toBeVisible()

  // 3. An upload that fails, then its retry.
  await page.route(uploadRoute(t), (r) => r.abort())
  await field.locator('input[type=file]').first().setInputFiles({name: 'fails.png', mimeType: 'image/png', buffer: fresh()})
  await expect(page.getByText('Upload failed').first()).toBeVisible({timeout: 10_000})
  await field.screenshot({path: shot(t.name, '3-failed')})
  await page.unroute(uploadRoute(t))
  const retry = field.getByRole('button', {name: 'Retry'})
  note('retry offered', await retry.count())
  if (await retry.count()) await retry.click()
  else await field.locator('input[type=file]').first().setInputFiles({name: 'again.png', mimeType: 'image/png', buffer: fresh()})
  await expect(preview(field)).toBeVisible({timeout: 20_000})

  // 4. Select from the library: tiles; a tile's usage; pick another to replace.
  await menuItem(t, page, field, 'Select')
  const library = page.getByRole('dialog', {name: /^Select image for/})
  await expect(library).toBeVisible()
  const tiles = t.name === 'sanity' ? library.getByRole('button', {name: /\.png$/}) : library.locator('.asset-pick')
  await expect(tiles.first()).toBeVisible({timeout: 15_000})
  note('library tiles', await tiles.count())
  // Stills once the visible thumbnails have loaded.
  await expect.poll(() => library.locator('img').evaluateAll((xs) => xs.slice(0, 5).every((x) => (x as HTMLImageElement).complete && (x as HTMLImageElement).naturalWidth > 0)), {timeout: 10_000}).toBe(true)
  await page.screenshot({path: shot(t.name, '4-library')})
  await tiles.first().hover()
  const more = t.name === 'sanity' ? library.locator('button').filter({hasNot: page.locator('img')}).filter({hasNot: page.locator('[data-sanity-icon="close"]')}).first() : library.getByRole('button', {name: /: more$/}).first()
  await more.click()
  await page.getByRole('menuitem', {name: 'Show usage'}).click()
  const usage = page.getByRole('dialog', {name: 'Documents using file'})
  await expect(usage).toBeVisible()
  await page.waitForTimeout(1500) // both look the usage up
  note('usage', await usage.innerText())
  await page.screenshot({path: shot(t.name, '5-usage')})
  await usage.getByRole('button', {name: 'Close dialog'}).click()
  await expect(usage).toHaveCount(0)
  const before = JSON.stringify(await t.docValue(ID, 'mainImage'))
  await tiles.nth(1).click()
  await expect(library).toHaveCount(0)
  await expect.poll(async () => JSON.stringify(await t.docValue(ID, 'mainImage')), {timeout: 10_000}).not.toBe(before)
  await field.screenshot({path: shot(t.name, '6-replaced')})

  // 5. Remove.
  await menuItem(t, page, field, 'Clear field')
  await expect(hint).toBeVisible()
  await expect.poll(() => t.docValue(ID, 'mainImage'), {timeout: 10_000}).toBeFalsy()
})
