import {expect, test} from '@playwright/test'
import {target, BACKEND_POLL} from '../rig/targets'

// J14 + J13, both studios, one doc, one page load. J14: field-group tabs (keyboard
// too) and the nested seo object, edited by two browsers at once (each subfield
// keeps its own value: no last-write-wins on the object). J13: rules from the schema, checked as you type;
// publish blocked until they pass; the Validation panel lists them.
const ID = 'post-18'  // author Ada: J17 counts Alan's posts, and Sanity's last write can land after the reset

test.afterEach(async ({}, info) => target(info).resetDoc(ID, 'post'))

test('J14 J13: field groups, the seo object, validation', async ({page, browser}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  // A second editor on the same doc, Meta tab, for the seo step.
  const ctxB = await browser.newContext()
  await t.prepare(ctxB)
  const b = await ctxB.newPage()
  await Promise.all([page.goto(t.docPath('post', ID)).then(() => t.settle(page)), b.goto(t.docPath('post', ID)).then(() => t.settle(b))])
  await b.getByRole('tab', {name: 'Meta'}).click()

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

  // Two editors, two subfields of the seo object, at the same time: both survive.
  const typeInto = async (p: typeof page, path: string, text: string) => {
    await t.field(p, path).click()
    await p.keyboard.press('ControlOrMeta+a')
    await p.keyboard.type(text)
  }
  await Promise.all([typeInto(page, 'seo.metaTitle', 'Better SEO title'), typeInto(b, 'seo.metaDescription', 'Better description')])
  await expect.poll(() => t.docValue(ID, 'seo'), BACKEND_POLL).toMatchObject({metaTitle: 'Better SEO title', metaDescription: 'Better description'})
  await ctxB.close()

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
