import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J52 evidence, both studios, post-22: a link with Sanity's `path=` param opens on
// that field (a top-level one and a nested one in another group); ours also writes
// the field you move to into the URL, so a reload or a copied link returns there
// (Sanity keeps the URL as it is on a click — recorded). Stills in e2e/evidence/.
const ID = 'post-22'
const shot = (name: string, step: string) => `evidence/J52-${name}-${step}.png`
const focusedId = (page: import('@playwright/test').Page) => page.evaluate(() => document.activeElement?.id ?? '')

test('@evidence J52: the focused field lives in the URL', async ({page, context}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => info.annotations.push({type: what, description: JSON.stringify(v)})
  await t.prepare(context)

  // Deep links: a top-level field, then a nested one in the Meta group.
  for (const path of ['excerpt', 'seo.metaTitle']) {
    await page.goto(`${t.docPath('post', ID)}${t.name === 'sanity' ? '%2C' : ','}path=${path}`)
    await signInIfAsked(page)
    await t.settle(page)
    await expect.poll(() => focusedId(page), {timeout: 15_000}).toBe(path)
    await page.screenshot({path: shot(t.name, `1-opened-${path}`)})
  }

  // Moving to a field: does the URL follow?
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await t.field(page, 'excerpt').click()
  await page.waitForTimeout(1200)
  const url = decodeURIComponent(page.url())
  note('URL after clicking Excerpt', new URL(url).pathname)
  if (t.name === 'sanity') return

  expect(url).toContain('path=excerpt')
  await page.reload()
  await t.settle(page)
  await expect.poll(() => focusedId(page), {timeout: 15_000}).toBe('excerpt')

  // A nested field in another group, then the URL copied into a fresh tab.
  await page.getByRole('tab', {name: 'Meta'}).click()
  await page.getByText(/^(SEO|Seo)$/).first().click() // collapsed by default (J13/J14)
  await t.field(page, 'seo.metaTitle').click()
  await expect.poll(() => decodeURIComponent(page.url())).toContain('path=seo.metaTitle')
  const copied = page.url()
  const fresh = await context.newPage()
  await fresh.goto(copied)
  await t.settle(fresh)
  await expect.poll(() => focusedId(fresh), {timeout: 15_000}).toBe('seo.metaTitle')
  await fresh.screenshot({path: shot(t.name, '2-copied-link')})
})
