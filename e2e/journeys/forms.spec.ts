import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// J14 + J13, both studios, one doc, one page load. J14: field-group tabs (keyboard
// too) and the nested seo object. J13: rules from the schema, checked as you type;
// publish blocked until they pass; the Validation panel lists them.
const ID = 'post-18'  // author Ada: J17 counts Alan's posts, and Sanity's last write can land after the reset

test.afterEach(async ({}, info) => target(info).resetDoc(ID, 'post'))

test('J14 J13: field groups, the seo object, validation', async ({page}, info) => {
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

  const publish = page.getByRole('button', {name: /^Publish$/}).last()

  // J13 — required title, emptied.
  await t.field(page, 'title').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect(publish).toBeDisabled()

  // Rating over its max (Meta group).
  await page.getByRole('tab', {name: 'Meta'}).click()
  await t.field(page, 'rating').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('9')

  await page.getByRole('button', {name: 'Validation'}).click()
  const panel = page.getByText('Must be lower than or equal to 5').filter({visible: true}).first()
  await expect(panel).toBeVisible()
  await expect(page.getByText('Required', {exact: true}).filter({visible: true}).first()).toBeVisible()

  // Fix both: publish comes back.
  await page.keyboard.press('ControlOrMeta+a')
  await t.field(page, 'rating').fill('3')
  await page.getByRole('tab', {name: 'Content'}).click()
  await t.field(page, 'title').fill('Fixture post 18 fixed')
  await expect(publish).toBeEnabled({timeout: 10_000})
  // Ours coalesces writes: let the last land before the reset.
  if (t.name === 'studio') await page.getByText(/^Saved$/).waitFor()
})
