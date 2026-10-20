import {readFileSync} from 'node:fs'
import {expect, test, type Page} from '@playwright/test'
import {BACKEND_POLL, closeAndSettle, signInIfAsked, target, type Target} from '../rig/targets'

// J36 widen, both studios: an array of images (post.gallery): add two by upload, each in
// its item dialog, then drag the second above the first, by keyboard and by mouse.
// Stills + clips go to e2e/evidence/. Not a CI gate (it uploads).
const ID = 'post-05'
const shot = (name: string, step: string) => `evidence/J36-${name}-gallery-${step}.png`
const PNG = readFileSync(new URL('../../fixtures/assets/fixture-image.png', import.meta.url))
// Two different files, so the two items are told apart by their assets.
const file = (n: string) => ({name: `gallery-${n}.png`, mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from(`gallery ${n} ${Date.now()}`)])})
const gallery = (t: Target, page: Page) => (t.name === 'sanity' ? page.locator('[data-testid="field-gallery"]') : page.locator('.field').filter({has: page.locator('[id="gallery"]')}).last())
const refs = async (t: Target) => (((await t.docValue(ID, 'gallery')) ?? []) as {asset?: {_ref?: string}}[]).map((i) => i.asset?._ref)

test.use({video: 'on'})
test.setTimeout(120_000)
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).restore(ID, {title: 'Fixture post 05'}, 'post', ['gallery'])))

test('@evidence J36: an array of images — add by upload, reorder by keyboard and mouse', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Content'}).click()
  const field = gallery(t, page)
  await field.scrollIntoViewIfNeeded()
  await field.screenshot({path: shot(t.name, '1-empty')})

  for (const n of ['a', 'b']) {
    await field.getByRole('button', {name: /Add item/}).click()
    const dialog = page.getByRole('dialog').last()
    await expect(dialog).toBeVisible()
    await dialog.locator('input[type=file]').first().setInputFiles(file(n))
    await expect(dialog.getByRole('img', {name: 'Preview of uploaded image'})).toBeVisible({timeout: 20_000})
    if (n === 'a') await page.screenshot({path: shot(t.name, '2-item-dialog')})
    await dialog.getByRole('button', {name: 'Close dialog'}).click()
    await expect(dialog).toBeHidden()
  }
  await expect.poll(async () => (await refs(t)).filter(Boolean).length, {...BACKEND_POLL, timeout: 15_000}).toBe(2)
  const [a, b] = await refs(t)
  await field.screenshot({path: shot(t.name, '3-two')})

  // Keyboard: pick up the second, one up, drop.
  const handles = field.locator('button[aria-roledescription="sortable"]')
  await handles.last().focus()
  for (const key of ['Space', 'ArrowUp', 'Space']) (await page.keyboard.press(key), t.name === 'sanity' && (await page.waitForTimeout(200)))
  await expect.poll(() => refs(t), BACKEND_POLL).toEqual([b, a])

  // Mouse: drag the last above the first.
  const from = (await handles.last().boundingBox())!
  const to = (await handles.first().boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y - 4, {steps: 12})
  await page.mouse.up()
  await expect.poll(() => refs(t), BACKEND_POLL).toEqual([a, b])
  await field.screenshot({path: shot(t.name, '4-reordered')})
})

// Several images dropped on the array at once, as Sanity's takes them: one item per file,
// each showing its picture and progress at once, each saved with its own asset.
test('@local J36: three images dropped on the gallery at once become three items, each with its asset', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: Sanity takes the same drop (measured by hand, task-c5b1cd9ad4a3d0c3)')
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Content'}).click()
  const field = gallery(t, page)
  await field.scrollIntoViewIfNeeded()
  const files = ['a', 'b', 'c'].map((n) => ({name: `drop-${n}.png`, b64: file(n).buffer.toString('base64')}))
  await field.locator('.array-drop').evaluate((el, files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, {type: 'image/png'}))
    for (const name of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(name, {bubbles: true, cancelable: true, dataTransfer: dt}))
  }, files)
  await expect(field.locator('.array-item-uploading').first(), 'each row shows its picture and progress at once').toBeVisible()
  await expect.poll(async () => (await refs(t)).filter(Boolean).length, {timeout: 30_000}).toBe(3)
  await expect(field.locator('.array-item-uploading')).toHaveCount(0)
  expect(new Set(await refs(t)).size, 'three different assets').toBe(3)
})
