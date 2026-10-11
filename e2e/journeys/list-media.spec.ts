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
  await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
  await page.waitForTimeout(500)
  await row.screenshot({path: shot(t.name, '1-row')})
  await page.screenshot({path: shot(t.name, '1-list')})

  // A reload: the thumbnail arrives in the server render (it can load before
  // hydration) and still shows, not a blank square.
  await page.reload()
  await t.settle(page)
  await expect.poll(() => row.locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity !== '0'), {timeout: 10_000}).toBe(true)

  // A crop to the image's left half: the thumbnail follows.
  const value = (await t.docValue(ID, 'mainImage')) as Record<string, unknown>
  // Sanity: the upload made a draft, and the list shows the draft.
  await t.patch(t.name === 'sanity' ? `drafts.${ID}` : ID, {mainImage: {...value, crop: {top: 0, bottom: 0, left: 0, right: 0.5}, hotspot: {x: 0.25, y: 0.5, width: 0.5, height: 1}}})
  await page.waitForTimeout(3000)
  await row.screenshot({path: shot(t.name, '2-row-cropped')})
})
