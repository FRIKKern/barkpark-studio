import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J58, Presentation: the site in an iframe beside "Documents on this page", and
// Sanity's connection states over it. The site is reference/preview-site (:3536).
const SITE = 'http://localhost:3536'
const shot = (name: string, step: string) => `evidence/J58-${name}-${step}.png`

test('@evidence J58: the site in Presentation, side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  await page.frameLocator('iframe').getByRole('heading', {name: 'Fixture post 01', level: 1}).waitFor({timeout: 30_000})
  await page.waitForTimeout(1500)
  await page.screenshot({path: shot(t.name, '1-connected')})
})

// Sanity's timings, on a fake clock: a site that loads but never connects shows
// "Loading.", then "Connecting." at 5 s, then gives up at 8 s with "Continue anyway";
// one that never loads gets the error card at 15 s with Retry.
test('J58: connecting, unable to connect, could not connect', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  // One handler for the whole test: unrouting would release a held request to the real site.
  let site: 'plain' | 'hang' | 'hello' = 'plain'
  await context.route(`${SITE}/**`, (route) =>
    site === 'hang'
      ? undefined
      : route.fulfill({
          contentType: 'text/html',
          body: site === 'plain' ? '<h1>A site without the preview script</h1>' : `<h1>Connected site</h1><script>parent.postMessage({bp: 'preview', type: 'hello'}, '*')</script>`,
        }),
  )
  await page.clock.install()
  await page.goto('/presentation')
  await signInIfAsked(page)
  const frame = page.locator('.presentation-frame')
  await expect(page.frameLocator('iframe').getByRole('heading', {name: 'A site without the preview script'})).toBeVisible()
  await expect(frame.getByRole('status')).toHaveText('Loading.')
  await page.clock.runFor(5_100)
  await expect(frame.getByRole('status')).toHaveText('Connecting.')
  await page.clock.runFor(3_100)
  await expect(frame.getByRole('status')).toHaveText('Unable to connect, check the browser console for more information.')
  await frame.getByRole('button', {name: 'Continue anyway'}).click()
  await expect(frame.getByRole('status')).toBeHidden()

  // A frame that never fires `load`.
  site = 'hang'
  await page.getByRole('button', {name: 'Refresh preview'}).click()
  await expect(frame.getByRole('status')).toHaveText('Loading.')
  await page.clock.runFor(15_100)
  await expect(frame.getByRole('alert')).toContainText('Could not connect to the preview')

  // Retry loads it again; a site that says hello clears every overlay.
  site = 'hello'
  await frame.getByRole('button', {name: 'Retry'}).click()
  await expect(page.frameLocator('iframe').getByRole('heading', {name: 'Connected site'})).toBeVisible()
  await expect(frame.getByRole('status')).toBeHidden()
  await expect(frame.getByRole('alert')).toBeHidden()
})

test('@local J58: the real site connects, follows its links, refreshes', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const site = page.frameLocator('iframe')
  await expect(site.getByRole('heading', {name: 'Fixture post 01', level: 1})).toBeVisible()
  await expect(page.locator('.presentation-frame').getByRole('status')).toBeHidden()
  await expect(page.getByLabel('URL')).toHaveValue(`${SITE}/posts/fixture-post-01`)
  await site.getByRole('link', {name: 'Reference site'}).click()
  await expect(page.getByLabel('URL')).toHaveValue(`${SITE}/`)
  await page.getByRole('button', {name: 'Refresh preview'}).click()
  await expect(site.getByRole('heading', {name: 'Posts'})).toBeVisible()
  await expect(page.locator('.presentation-frame').getByRole('status')).toBeHidden()
})
