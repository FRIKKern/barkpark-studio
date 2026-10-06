import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target} from '../rig/targets'

// J12 evidence, both studios, on post-05's main image: upload, alt text, then
// hotspot and crop in the "Edit hotspot and crop" dialog — by mouse (resize the
// hotspot, pull the crop's right edge in, move the hotspot) and by keyboard (the
// hotspot and the crop are focusable; arrows move 0.5%, Shift+arrows 2.5%). The
// stored values go to the annotations; the keyboard steps must match exactly.
// Stills + clips go to e2e/evidence/. Not a CI gate (it uploads).
const ID = 'post-05'
const shot = (name: string, step: string) => `evidence/J12-${name}-${step}.png`
type Img = {alt?: string; hotspot?: {x: number; y: number; width: number; height: number}; crop?: {left: number; right: number; top: number; bottom: number}}

const imageField = (t: Target, page: Page) =>
  t.name === 'sanity' ? page.locator('fieldset').filter({has: page.getByTestId('image-input')}).last() : page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})

test.use({video: 'on'})
test.setTimeout(90_000)
test.afterEach(async ({}, info) => target(info).restore(ID, {title: 'Fixture post 05'}, 'post', ['mainImage']))

test('@evidence J12: image upload, alt text, hotspot and crop by mouse and keyboard', async ({page}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => info.annotations.push({type: what, description: JSON.stringify(v)})
  const value = async () => ((await t.docValue(ID, 'mainImage')) ?? {}) as Img
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Content'}).click()
  const field = imageField(t, page)
  await field.scrollIntoViewIfNeeded()
  await expect(field.getByText('Drag or paste image here')).toBeVisible()
  await field.screenshot({path: shot(t.name, '1-empty')})

  // Upload.
  await field.locator('input[type=file]').first().setInputFiles('../fixtures/assets/fixture-image.png')
  await expect(field.getByRole('img', {name: 'Preview of uploaded image'})).toBeVisible({timeout: 20_000})
  await expect(field.getByRole('button', {name: 'Open image edit dialog'})).toBeVisible()
  await field.screenshot({path: shot(t.name, '2-uploaded')})

  // Alt text, a field of the image.
  await field.getByRole('textbox', {name: 'Alternative text'}).fill('A sun over a field')
  await expect.poll(async () => (await value()).alt, {timeout: 10_000}).toBe('A sun over a field')

  // Hotspot and crop, by mouse.
  const edit = field.getByRole('button', {name: 'Open image edit dialog'})
  await edit.click()
  const dialog = page.getByRole('dialog', {name: 'Edit hotspot and crop'})
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(800) // Sanity's dialog animates in
  const drag = async (handle: string, dx: number, dy: number) => {
    const b = (await dialog.locator(`[data-handle="${handle}"]`).first().boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {steps: 6})
    await page.mouse.up()
  }
  await drag('hotspotHandle', -180, -110)
  await drag('crop-right', -100, 0)
  await drag('hotspot', -40, 20)
  await expect.poll(async () => (await value()).hotspot?.x ?? 0.5, {timeout: 10_000}).toBeLessThan(0.45)
  if (t.name === 'sanity') await page.waitForTimeout(2000) // its writes land late; read the settled value
  const byMouse = await value()
  note('after mouse', {hotspot: byMouse.hotspot, crop: byMouse.crop})
  expect(byMouse.hotspot!.width).toBeLessThan(0.5)
  expect(byMouse.crop!.right).toBeGreaterThan(0.1)
  await page.screenshot({path: shot(t.name, '3-mouse')})

  // By keyboard: hotspot left ×5 and Shift+up ×3; crop right ×4.
  await dialog.locator('[data-handle="hotspot"]').focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowUp')
  await dialog.locator('[data-handle="crop"][tabindex="0"]').focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  // Read until the keyed value shows (Sanity's query API can answer from before its last write).
  let byKeys: Img = {}
  await expect.poll(async () => ((byKeys = await value()).crop?.left ?? 0) > 0 && byKeys.hotspot!.y < byMouse.hotspot!.y - 0.05, {timeout: 10_000}).toBe(true)
  note('after keys', {hotspot: byKeys.hotspot, crop: byKeys.crop})
  expect(byKeys.hotspot!.x).toBeCloseTo(byMouse.hotspot!.x - 0.025, 4)
  expect(byKeys.hotspot!.y).toBeCloseTo(byMouse.hotspot!.y - 0.075, 4)
  expect(byKeys.crop!.left).toBeCloseTo(0.02, 4)
  expect(byKeys.crop!.right).toBeCloseTo(byMouse.crop!.right - 0.02, 4)
  await page.screenshot({path: shot(t.name, '4-keys')})

  // Escape closes; focus goes back to the button that opened it (F13).
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  note('focus after Escape', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName))
  if (t.name === 'studio') await expect(edit).toBeFocused()
  await field.screenshot({path: shot(t.name, '5-done')})
})
