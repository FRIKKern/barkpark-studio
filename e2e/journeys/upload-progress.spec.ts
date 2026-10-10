import {expect, test} from '@playwright/test'
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
  await expect.poll(() => held, {message: 'the upload is sent (after the library is asked for its bytes)'}).toBe(true)
  await card.getByRole('button', {name: 'Cancel'}).click()
  await expect(card).toBeHidden()
  await expect(field.getByText('fixture-attachment.txt')).toBeVisible()
  await expect(page.getByText('Upload failed')).toHaveCount(0)
})
