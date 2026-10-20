import {expect, test, type Page} from '@playwright/test'
import {BACKEND_POLL, closeAndSettle, target} from '../rig/targets'

// Copy and paste go through the system clipboard in Sanity's format (task-11fcedbfe2d62bc8):
// a field copied here pastes in another tab, a field copied in Sanity pastes here, and after
// copying anything else Paste field says "Nothing to paste" (it pasted a stale studio copy).
const ID = 'post-22'
test.use({permissions: ['clipboard-read', 'clipboard-write']})
test.afterEach(async ({page}, info) => (await closeAndSettle(page), await target(info).resetDoc(ID, 'post')))

const fieldMenu = async (page: Page, field: string, item: 'Copy field' | 'Paste field') => {
  const box = page.locator('.field').filter({has: page.locator(`[id="${field}"]`)}).last()
  await box.hover()
  await box.locator(':scope > .field-actions button[aria-label="Field actions"]').click()
  await page.getByRole('menuitem', {name: item}).click()
}
const SANITY_TYPE = 'web application/vnd.sanity-clipboard-item+json'

test('the field clipboard is the system clipboard, in Sanity\'s format', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours (Sanity's is the format)")
  await t.prepare(context)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)

  // Copy: Sanity's item (schema type, path, value), base64 in text/html, the words as text.
  await fieldMenu(page, 'excerpt', 'Copy field')
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.read())[0]?.types.join('|') ?? ''), {intervals: [50]}).toContain(SANITY_TYPE)
  const written = await page.evaluate(async (type) => {
    const [item] = await navigator.clipboard.read()
    return {json: JSON.parse(await (await item!.getType(type)).text()), html: await (await item!.getType('text/html')).text(), text: await (await item!.getType('text/plain')).text()}
  }, SANITY_TYPE)
  expect(written.json).toMatchObject({type: 'sanityClipboardItem', documentId: ID, documentType: 'post', isDocument: false, schemaTypeName: 'string', valuePath: ['excerpt'], value: 'Short excerpt for post 22.', patchType: 'replace'})
  expect(written.html).toMatch(/^<div data-sanity-clipboard-base64="[A-Za-z0-9+/=]+"><p>Short excerpt for post 22\.<\/p><\/div>$/)
  expect(written.text).toBe('Short excerpt for post 22.')

  // Another tab pastes it.
  const other = await context.newPage()
  await other.goto(t.docPath('post', ID))
  await t.settle(other)
  await fieldMenu(other, 'title', 'Paste field')
  await expect(t.field(other, 'title')).toHaveValue('Short excerpt for post 22.')
  await expect.poll(() => t.docValue(ID, 'title'), {...BACKEND_POLL, timeout: 5_000}).toBe('Short excerpt for post 22.')
  await closeAndSettle(other)

  // Something else copied since: nothing to paste, the title kept.
  await page.reload()
  await t.settle(page)
  await page.evaluate(() => navigator.clipboard.writeText('text copied from another app'))
  await fieldMenu(page, 'title', 'Paste field')
  await expect(page.getByText('Nothing to paste')).toBeVisible()
  await expect(t.field(page, 'title')).toHaveValue('Short excerpt for post 22.')

  // A field copied in Sanity (its item, no Barkpark part) pastes here.
  await page.evaluate(async (type) => {
    const item = {type: 'sanityClipboardItem', documentId: 'post-22', documentType: 'post', isDocument: false, schemaTypeName: 'string', valuePath: ['title'], value: 'Copied in Sanity', patchType: 'replace'}
    await navigator.clipboard.write([new ClipboardItem({[type]: new Blob([JSON.stringify(item)], {type: type.replace(/^web /, '')}), 'text/plain': new Blob(['Copied in Sanity'], {type: 'text/plain'})})])
  }, SANITY_TYPE)
  await fieldMenu(page, 'title', 'Paste field')
  await expect(t.field(page, 'title')).toHaveValue('Copied in Sanity')
})
