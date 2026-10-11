import {expect, test} from '@playwright/test'
import {target, closeAndSettle} from '../rig/targets'

// The image and file pickers reach every asset, a page at a time ("Load more", as Sanity's).
// It once read one page of every kind and kept the images: at scale (303 images, 50
// files) 138 showed and the rest could never be picked. The pages are answered here.
test.afterEach(async ({page}) => (await page.unrouteAll({behavior: 'ignoreErrors'}), await closeAndSettle(page)))

test('J36: the image picker pages with Load more until the last image', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our picker')
  await t.prepare(page.context())
  const img = (n: number) => ({id: `00000000-0000-4000-8000-00000000000${n}`, name: `paged-${n}.png`, createdAt: ''})
  await page.route('**/api/media/?offset=*', (r) => {
    const offset = Number(new URL(r.request().url()).searchParams.get('offset'))
    return r.fulfill({json: offset === 0 ? {images: [img(1), img(2)], nextOffset: 2, total: 3} : {images: [img(3)], nextOffset: null, total: 3}})
  })
  await page.goto(t.docPath('post', 'post-06'))
  await t.settle(page)
  await page.getByRole('tab', {name: 'All fields'}).click().catch(() => {})
  const field = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
  const select = field.getByRole('button', {name: 'Select'})
  if (await select.isVisible()) await select.click()
  else (await field.getByRole('button', {name: 'Open image options menu'}).click(), await page.getByRole('menuitem', {name: 'Select'}).click())
  const library = page.getByRole('dialog', {name: /^Select image for/})
  await expect(library.locator('.asset-pick')).toHaveCount(2)
  await library.getByRole('button', {name: 'Load more', exact: true}).click()
  await expect(library.locator('.asset-pick')).toHaveCount(3)
  await expect(library.getByRole('button', {name: 'paged-3.png', exact: true})).toBeVisible()
  await expect(library.getByRole('button', {name: 'Load more', exact: true})).toHaveCount(0)
})

// The file picker too: files are what a field accepts among every kind of media, newest
// first; the studio server reads batches and answers a page at a time (nextOffset).
test('J54: the file picker pages with Load more until the last file', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our picker')
  await t.prepare(page.context())
  const file = (n: number) => ({id: `00000000-0000-4000-8000-00000000001${n}`, name: `paged-${n}.pdf`, size: 1000, mimeType: 'application/pdf', createdAt: ''})
  await page.route('**/api/media/files?offset=*', (r) => {
    const offset = Number(new URL(r.request().url()).searchParams.get('offset'))
    return r.fulfill({json: offset === 0 ? {files: [file(1), file(2)], nextOffset: 7} : {files: [file(3)], nextOffset: null}})
  })
  await page.goto(t.docPath('post', 'post-03'))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  const field = page.locator('.field').filter({has: page.getByText('Attachment', {exact: true})}).last()
  await field.getByRole('button', {name: 'Open file options menu'}).click()
  await page.getByRole('menuitem', {name: 'Select'}).click()
  const picker = page.getByRole('dialog', {name: /^Select file for/})
  await expect(picker.locator('.file-pick')).toHaveCount(2)
  await picker.getByRole('button', {name: 'Load more', exact: true}).click()
  await expect(picker.locator('.file-pick')).toHaveCount(3)
  await expect(picker.getByRole('button', {name: 'Load more', exact: true})).toHaveCount(0)
})
