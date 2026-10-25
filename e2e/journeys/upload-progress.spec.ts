import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// Sanity's upload card on post-03's attachment (J54's field): while a file uploads,
// its name over a progress bar and Cancel; Cancel stops it and the field keeps its
// file. The upload is held here and never sent, so nothing is written.
test('J54: upload progress with Cancel leaves the field as it was', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(page.context())
  let held = false
  await page.route('**/api/media/upload', () => void (held = true)) // never answered
  await page.goto(t.docPath('post', 'post-03'))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  const field = page.locator('.field').filter({has: page.locator('.file-input')}).last()
  await expect(field.getByText('fixture-attachment.txt')).toBeVisible()

  await field.locator('input[type="file"]').setInputFiles({name: 'J54 upload.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n')})
  const card = field.getByRole('status', {name: 'Uploading J54 upload.pdf'})
  await expect(card).toBeVisible()
  await expect(card.getByRole('progressbar')).toBeVisible()
  await expect.poll(() => held, {intervals: [50], message: 'the upload is sent (after the library is asked for its bytes)'}).toBe(true)
  await card.getByRole('button', {name: 'Cancel'}).click()
  await expect(card).toBeHidden()
  await expect(field.getByText('fixture-attachment.txt')).toBeVisible()
  await expect(page.getByText('Upload failed')).toHaveCount(0)
})

// A file of a type the field doesn't take is refused and said, never uploaded and stored: the
// chooser's "All files" let a text file in as the image and as the PDF attachment (Sanity's
// refuses both). Nothing is sent, so nothing is written.
test("J54: a file the field doesn't take is refused, not uploaded", async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours')
  await t.prepare(page.context())
  let sent = 0
  await page.route('**/api/media/upload', (r) => (sent++, r.abort()))
  await page.goto(t.docPath('post', 'post-03'))
  await signInIfAsked(page)
  await t.settle(page)
  const text = {name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a PDF, not an image\n')}
  await page.getByRole('tab', {name: 'Meta'}).click()
  const file = page.locator('.field').filter({has: page.locator('.file-input')}).last()
  await file.locator('input[type="file"]').setInputFiles(text)
  await expect(page.getByText("Can't upload this file here")).toHaveCount(1)
  await expect(file.getByText('fixture-attachment.txt')).toBeVisible()
  await page.getByRole('tab', {name: 'Content'}).click()
  const image = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
  await image.locator('input[type="file"]').first().setInputFiles(text)
  await expect(page.getByText("Can't upload this file here").first()).toBeVisible()
  await page.waitForTimeout(500) // an upload would have started by now
  await expect(image.getByText('Drag or paste image here')).toBeVisible()
  await expect(image.getByRole('status')).toHaveCount(0) // no upload card
  expect(sent).toBe(0)
})
