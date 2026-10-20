import {expect, test, type Locator, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// J54, both studios, on post-03's attachment (the seed's fixture-attachment.txt, a real
// file on both sides: barkpark#22289): its name and size; Clear field empties it; a PDF
// uploaded through the chooser takes its place and is stored as the canonical file value,
// {_type: 'file', asset: {_type: 'reference', _ref}}. Not a CI gate (it uploads).
const ID = 'post-03'
const shot = (name: string, step: string) => `evidence/J54-${name}-${step}.png`
// A byte-different PDF each run: Sanity reuses an asset whose hash it knows.
const pdf = () => ({name: 'J54 upload.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${Date.now()}\n%%EOF\n`)})

const fileField = (t: Target, page: Page) =>
  t.name === 'sanity' ? page.locator('fieldset').filter({hasText: 'Attachment'}).last() : page.locator('.field').filter({has: page.locator('.file-input')}).last()

test.use({video: 'on'})
test.setTimeout(120_000)
test.beforeEach(async ({}, info) => target(info).resetDoc(ID, 'post'))
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).resetDoc(ID, 'post')))

test('@evidence J54: a seeded file shows name and size; clear; upload a PDF; canonical value', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  const field: Locator = fileField(t, page)
  await field.scrollIntoViewIfNeeded()

  // 1. The seeded file: its name and size.
  await expect(field.getByText('fixture-attachment.txt')).toBeVisible()
  await expect(field.getByText('99 Bytes')).toBeVisible()
  await field.screenshot({path: shot(t.name, '1-seeded')})

  // 2. Clear field: the empty drop box.
  await field.getByRole('button', {name: 'Open file options menu'}).click()
  if (t.name === 'sanity') await page.waitForTimeout(400) // its menu animates in
  await page.getByRole('menuitem', {name: 'Clear field'}).click()
  await expect(field.getByText('Drag or paste file here')).toBeVisible()
  await field.screenshot({path: shot(t.name, '2-cleared')})

  // 3. Upload a PDF through the chooser: its name replaces the hint. Sanity's Upload is
  // a label over its file input (the Select button beside it takes a pointer click).
  if (t.name === 'sanity') await field.locator('input[type="file"]').setInputFiles(pdf())
  else {
    const chooser = page.waitForEvent('filechooser')
    await field.getByRole('button', {name: 'Upload'}).click()
    await (await chooser).setFiles(pdf())
  }
  await expect(field.getByText('J54 upload.pdf')).toBeVisible({timeout: 20_000})
  await expect(field.getByText('31 Bytes')).toBeVisible({timeout: 20_000}) // uploaded, not uploading
  await field.screenshot({path: shot(t.name, '3-uploaded')})

  // 4. Stored as the canonical file value.
  await expect.poll(() => t.docValue(ID, 'attachment'), {timeout: 10_000}).toMatchObject({_type: 'file', asset: {_type: 'reference', _ref: expect.any(String)}})
  info.annotations.push({type: 'stored', description: JSON.stringify(await t.docValue(ID, 'attachment'))})
})
