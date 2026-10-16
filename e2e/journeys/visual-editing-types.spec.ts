import {expect, test} from '@playwright/test'
import {closeAndSettle, signInIfAsked, target} from '../rig/targets'

// J59 widen, both studios, the real reference site (reference/preview-site) on post-02:
// click-to-edit on the field types the page now shows besides text: a reference item
// (a category chip: its own document), a number (rating), a date (publishedAt) and an
// image (mainImage, set for the run). Sanity marks the non-strings with its data
// attribute, Barkpark with its source map. Not a CI gate (it needs the site).
const ID = 'post-02'
const shot = (name: string, step: string) => `evidence/J59-${name}-types-${step}.png`
test.setTimeout(120_000)
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).restore(ID, {title: 'Fixture post 02'}, 'post', ['mainImage'])))

test('@evidence J59: click-to-edit on a reference item, a number, a date and an image', async ({page, context}, info) => {
  const t = target(info)
  await t.restore(ID, {mainImage: {_type: 'image', alt: 'A sun over a field'}})
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-02')
  await signInIfAsked(page)
  const site = page.frameLocator('iframe')
  await site.getByRole('heading', {name: 'Fixture post 02', level: 1}).waitFor({timeout: 40_000})
  await page.waitForTimeout(2500)
  const focused = () => page.evaluate(() => document.activeElement?.closest('[id]')?.id ?? '')
  const steps: [string, ReturnType<typeof site.locator>, RegExp, string][] = [
    ['category', site.locator('.chip').first(), /category/, 'title'],
    ['rating', site.getByText(/^Rating \d/), /post/, 'rating'],
    ['date', site.locator('time'), /post/, 'publishedAt'],
    ['image', site.locator('figure.image'), /post/, 'mainImage'],
  ]
  for (const [name, el, type, field] of steps) {
    await el.hover()
    await page.waitForTimeout(500)
    await page.screenshot({path: shot(t.name, `${name}-hover`)})
    await el.click()
    await expect.poll(() => decodeURIComponent(page.url()), {intervals: [50], timeout: 10_000}).toMatch(type)
    await page.waitForTimeout(1200)
    info.annotations.push({type: name, description: JSON.stringify({url: decodeURIComponent(page.url()).replace(/^https?:\/\/[^/]+/, '').slice(0, 160), focused: await focused()})})
    if (t.name === 'studio') expect(await focused(), `${name} focuses its field`).toContain(field)
    await page.screenshot({path: shot(t.name, `${name}-opened`)})
  }
})
