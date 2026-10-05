import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// J14, both studios: field-group tabs (keyboard too) and the nested seo object.
const ID = 'post-18'

test.afterEach(async ({}, info) => target(info).resetDoc(ID, 'post'))

test('J14: field groups and the seo object', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)

  // Default group is Content: its fields show, Meta's don't.
  await expect(t.field(page, 'title')).toBeVisible()
  await expect(t.field(page, 'publishedAt')).toHaveCount(0)

  // Keyboard: from the Content tab, ArrowRight to Meta, Enter.
  await page.getByRole('tab', {name: 'Content'}).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', {name: 'Meta'})).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(t.field(page, 'publishedAt')).toBeVisible()
  await expect(t.field(page, 'title')).toHaveCount(0)

  // A subfield of the seo object: the other subfield is kept.
  const metaTitle = t.field(page, 'seo.metaTitle')
  await metaTitle.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Better SEO title')
  await expect.poll(() => t.docValue(ID, 'seo'), {timeout: 10_000}).toMatchObject({metaTitle: 'Better SEO title', metaDescription: 'Fixture SEO.'})

  // All fields shows both groups.
  await page.getByRole('tab', {name: 'All fields'}).click()
  await expect(t.field(page, 'title')).toBeVisible()
  await expect(t.field(page, 'publishedAt')).toBeVisible()
})
