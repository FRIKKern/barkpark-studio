import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// List thumbnails, both studios: post's preview selects media: mainImage, so a post
// with an image shows it in its list row; a crop narrows what the thumbnail shows.
// Uploads to post-05 (restored after). Stills in e2e/evidence/list-media-*.
const ID = 'post-05'
const shot = (name: string, step: string) => `evidence/list-media-${step}-${name}.png`
test.setTimeout(90_000)
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).restore(ID, {title: 'Fixture post 05'}, 'post', ['mainImage'])))

const imageField = (t: Target, page: Page) =>
  t.name === 'sanity' ? page.locator('fieldset').filter({has: page.getByTestId('image-input')}).last() : page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})

test('@evidence list rows show the main image, cropped', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Content'}).click()
  const field = imageField(t, page)
  await field.locator('input[type=file]').first().setInputFiles('../fixtures/assets/fixture-image.png')
  await expect.poll(async () => ((await t.docValue(ID, 'mainImage')) as {asset?: unknown} | undefined)?.asset, {timeout: 20_000}).toBeTruthy()

  const row = t.listItem(page, ID)
  const thumb = row.locator('img').first()
  await expect(thumb).toBeVisible({timeout: 20_000})
  await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), {intervals: [50]}).toBe(true)
  await page.waitForTimeout(500)
  await row.screenshot({path: shot(t.name, '1-row')})
  await page.screenshot({path: shot(t.name, '1-list')})

  // A reload: the thumbnail arrives in the server render (it can load before
  // hydration) and still shows, not a blank square.
  await page.reload()
  await t.settle(page)
  await expect.poll(() => row.locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity !== '0'), {intervals: [50], timeout: 10_000}).toBe(true)

  // A crop to the image's left half: the thumbnail follows.
  const value = (await t.docValue(ID, 'mainImage')) as Record<string, unknown>
  // Sanity: the upload made a draft, and the list shows the draft.
  await t.patch(t.name === 'sanity' ? `drafts.${ID}` : ID, {mainImage: {...value, crop: {top: 0, bottom: 0, left: 0, right: 0.5}, hotspot: {x: 0.25, y: 0.5, width: 0.5, height: 1}}})
  await page.waitForTimeout(3000)
  await row.screenshot({path: shot(t.name, '2-row-cropped')})
})

// task-c74e7cdf5b119f87: a media path that holds an image URL (a field of type url,
// as Barkpark's list_preview contract takes) draws that image; an empty URL and one
// that fails to load fall back to the document icon. Ours only: Sanity's media is a
// prepare function. The image host is example.com, served or refused by the route.
const URL_DOC = 'post-url-media'
const IMAGE = 'https://images.example.com/covers/fixture.png'
const BROKEN = 'https://images.example.com/covers/missing.png'
test('@local a row whose media is an image URL draws it; empty or failing falls back', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: Sanity media is a prepare function')
  await context.route(IMAGE, (r) => r.fulfill({path: '../fixtures/assets/fixture-image.png', contentType: 'image/png'}))
  await context.route(BROKEN, (r) => r.fulfill({status: 404, body: ''}))
  await t.draftOnly(URL_DOC, 'post', {title: 'URL media', mainImage: IMAGE})
  try {
    await t.prepare(context)
    await page.goto(t.docPath('post', URL_DOC))
    await signInIfAsked(page)
    await t.settle(page)
    const row = t.listItem(page, URL_DOC)
    const img = row.getByTestId('row-media-url')
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), {intervals: [50], timeout: 10_000}).toBe(true)
    await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    // Sized as other thumbnails: it fills the row's media square.
    const [box, square] = await Promise.all([img.boundingBox(), row.locator('.media').boundingBox()])
    expect(box && square && Math.round(box.width) === Math.round(square.width) && Math.round(box.height) === Math.round(square.height)).toBe(true)
    await row.screenshot({path: 'evidence/list-media-url-1-row.png'})

    // A URL that fails to load: the document icon, never a broken image.
    await t.patch(URL_DOC, {mainImage: BROKEN})
    await expect(row.locator('.media svg')).toBeVisible({timeout: 10_000})
    await expect(row.locator('.media img')).toHaveCount(0)

    // An empty URL: the document icon.
    await t.patch(URL_DOC, {mainImage: ''})
    await expect(row.locator('.media svg')).toBeVisible({timeout: 10_000})
    await expect(row.locator('.media img')).toHaveCount(0)
  } finally {
    await closeAndSettle(page)
    await t.deleteDoc(URL_DOC, 'post')
  }
})

// A row with no media draws its type's icon, as Sanity's: category has the tag icon
// (fixtures/barkpark-schema/category.json, reference/sanity/schemaTypes/category.ts), and
// so does a reference to one. Post has no icon: its row without an image keeps the document icon.
test('@local a row with no media draws its type icon', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('category', 'category-guide'))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(t.listItem(page, 'category-news').locator('.media svg[data-sanity-icon="tag"]')).toBeVisible({timeout: 10_000})
  await t.listItem(page, 'category-news').screenshot({path: `evidence/list-media-type-icon-${t.name}.png`})
})
