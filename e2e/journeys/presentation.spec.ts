import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J58, Presentation: the site in an iframe beside "Documents on this page", and
// Sanity's connection states over it. The site is reference/preview-site: from
// Barkpark for ours, from Sanity for the reference (PREVIEW_SITE_PORT_BARKPARK / PREVIEW_SITE_PORT).
const SITE = `http://localhost:${process.env.PREVIEW_SITE_PORT_BARKPARK}` // playwright.config sets both
const SANITY_SITE = `http://localhost:${process.env.PREVIEW_SITE_PORT}`
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

// J14 + J46 in Presentation, as Sanity's: the panel (under 360 px) shows the field groups
// as a select; under 900 px a tab bar shows one panel at a time, the page or the document.
test('@local J14 J46: the panel\'s groups are a select; at phone width a tab bar switches page and document', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const panel = page.locator('.presentation-panel')
  const groups = panel.getByRole('combobox', {name: 'Field groups'})
  await expect(groups).toHaveValue('content')
  await expect(panel.getByRole('tablist', {name: 'Field groups'})).toBeHidden()
  await groups.selectOption({label: 'Meta'})
  await expect(panel.getByText('Published at', {exact: true})).toBeVisible()
  await expect(panel.locator('[id="title"]')).toHaveCount(0)
  await groups.selectOption({label: 'Content'})

  await page.setViewportSize({width: 390, height: 844})
  const bar = page.getByRole('tablist', {name: 'Presentation'})
  await expect(bar.getByRole('tab', {name: 'Presentation'})).toHaveAttribute('aria-selected', 'true')
  await expect(page.frameLocator('iframe').getByRole('heading', {name: 'Fixture post 01', level: 1})).toBeVisible()
  await expect(panel).toBeHidden()
  await bar.getByRole('tab', {name: 'Structure'}).click()
  await expect(panel.locator('[id="title"]')).toBeVisible()
  await expect(page.locator('.presentation-preview')).toBeHidden()
  await bar.getByRole('tab', {name: 'Presentation'}).click()
  await expect(page.locator('.presentation-preview')).toBeVisible()
})

// J61 on a stand-in site that speaks the preview protocol: links and the URL bar move
// it; the panel shows the page's main document (by slug, by id), the documents on a
// page without one, and says when a route's document is missing.
const standIn = (path: string) => `<!doctype html><title>${path}</title>
<a href="/authors/author-alan">Alan</a> <a href="/">Home</a>
<script>
  const post = (m) => parent.postMessage({bp: 'preview', ...m}, '*')
  post({type: 'hello'})
  post({type: 'location', url: location.pathname})
  post({type: 'documents', documents: location.pathname === '/' ? [{_id: 'post-01', _type: 'post'}, {_id: 'author-alan', _type: 'author'}] : []})
  addEventListener('message', (e) => e.data?.bp === 'studio' && e.data.type === 'navigate' && location.assign(e.data.url))
</script>`

test('J61: links and the URL bar move the page; the panel follows it', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await context.route(`${SITE}/**`, (route) => route.fulfill({contentType: 'text/html', body: standIn(new URL(route.request().url()).pathname)}))
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const panel = page.locator('.presentation-panel')
  // The main document by slug, in the same document pane as /structure.
  await expect(panel.locator('[id="title"]')).toHaveValue('Fixture post 01')
  await expect(page).toHaveURL(/[?&]pane=post%3Bpost-01/)

  // A link in the page: the URL, the URL bar and the panel follow.
  await page.frameLocator('iframe').getByRole('link', {name: 'Alan'}).click()
  await expect(page.getByLabel('URL')).toHaveValue(`${SITE}/authors/author-alan`)
  await expect(page).toHaveURL(/preview=%2Fauthors%2Fauthor-alan/)
  await expect(panel.locator('[id="name"]')).toHaveValue('Alan Turing')

  // A page no route claims keeps the panel (Sanity's too).
  await page.getByLabel('URL').fill('/')
  await page.getByLabel('URL').press('Enter')
  await expect(page).toHaveURL(/preview=%2F&pane=author/)
  await expect(panel.locator('[id="name"]')).toHaveValue('Alan Turing')

  // A route whose document does not exist says so, over the documents on the page.
  await page.getByLabel('URL').fill(`${SITE}/authors/nobody`)
  await page.getByLabel('URL').press('Enter')
  await expect(panel.getByRole('status')).toHaveText(/Missing a main document for\s*\/authors\/nobody/)
  await expect(panel.getByRole('heading', {name: 'Documents on this page'})).toBeVisible()

  // The documents on a page open in the panel.
  await page.frameLocator('iframe').getByRole('link', {name: 'Home'}).click()
  await expect(panel.getByRole('link')).toHaveCount(2)
  await panel.getByRole('link', {name: /Fixture post 01/}).click()
  await expect(panel.locator('[id="title"]')).toHaveValue('Fixture post 01')
  await expect(page).toHaveURL(/preview=%2F&pane=post/)
})

test('@evidence J61: the panel follows the page, side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const site = page.frameLocator('iframe')
  const bar = t.name === 'sanity' ? page.locator(`input[value^="${SANITY_SITE}"]`).first() : page.getByLabel('URL')
  await site.getByRole('heading', {name: 'Fixture post 01', level: 1}).waitFor({timeout: 30_000})
  await page.waitForTimeout(2500)
  await page.screenshot({path: `evidence/J61-${t.name}-1-post.png`})
  for (const [step, path, ready] of [['2-author', '/authors/author-alan', 'Alan Turing'], ['3-home', '/', 'Posts'], ['4-missing', '/authors/nobody', 'Not found']] as const) {
    await bar.fill(`${t.name === 'sanity' ? SANITY_SITE : SITE}${path}`)
    await bar.press('Enter')
    await site.getByRole('heading', {name: ready, level: 1}).waitFor()
    await page.waitForTimeout(2500)
    await page.screenshot({path: `evidence/J61-${t.name}-${step}.png`})
  }
})

// J64: the phone viewport (Sanity's 375×650, kept in the URL), Open preview, and the
// share menu: nothing shared yet (no QR code, nothing to copy), then shared (any write
// member may, Barkpark #22488), then off. Stopping a link is an admin's: CI's token is
// a member's, so there Barkpark refuses and the menu says the link runs out by itself.
test('J64: viewport toggle, Open preview, share menu', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await context.route(`${SITE}/**`, (route) => route.fulfill({contentType: 'text/html', body: standIn(new URL(route.request().url()).pathname)}))
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const toggle = page.getByRole('button', {name: 'Toggle viewport size'})
  await expect(toggle).toHaveAttribute('data-tip', 'Switch to narrow viewport')
  await toggle.click()
  await expect(page).toHaveURL(/viewport=mobile/)
  await expect(page.locator('.presentation-frame iframe')).toHaveCSS('width', '375px')
  await expect(toggle).toHaveAttribute('data-tip', 'Switch to full viewport')
  await page.reload()
  await expect(page.locator('.presentation-frame iframe')).toHaveCSS('width', '375px')
  await toggle.click()
  await expect(page).not.toHaveURL(/viewport=/)

  await expect(page.getByRole('link', {name: 'Open preview'})).toHaveAttribute('href', `${SITE}/posts/fixture-post-01`)
  await page.getByRole('button', {name: 'Share this preview'}).click()
  const share = page.getByRole('dialog', {name: 'Share this preview'})
  await expect(share.getByRole('switch')).not.toBeChecked()
  await expect(share).toContainText('QR code will appear here')
  await expect(share.getByRole('button', {name: 'Copy preview link'})).toBeDisabled()
  await share.getByRole('switch').click()
  await expect(share.getByRole('switch')).toBeChecked()
  await expect(share.getByRole('img', {name: /QR Code which encodes the URL: .*bp-share=/})).toBeVisible()
  await expect(share.getByRole('button', {name: 'Copy preview link'})).toBeEnabled()
  await share.getByRole('switch').click()
  // An admin's token stops it; a member's is refused, and the menu says why.
  await expect(async () => expect(!(await share.getByRole('switch').isChecked()) || (await share.getByRole('alert').filter({hasText: 'Only an admin can stop a shared link'}).isVisible())).toBe(true)).toPass({timeout: 5_000})
  await page.keyboard.press('Escape')
  await expect(share).toBeHidden()
})

test('@evidence J64: phone viewport and share menu, side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  await page.frameLocator('iframe').getByRole('heading', {name: 'Fixture post 01', level: 1}).waitFor({timeout: 30_000})
  await page.getByRole('button', {name: 'Toggle viewport size'}).click()
  await page.waitForTimeout(2000)
  await page.screenshot({path: `evidence/J64-${t.name}-1-mobile.png`})
  await page.getByRole('button', {name: 'Share this preview'}).click()
  await page.waitForTimeout(1000)
  await page.screenshot({path: `evidence/J64-${t.name}-2-share.png`})
})

// J62: the locations banner. A post's own pages (the studio config); an author's own
// page plus the pages of the posts that reference it (Barkpark's locations, from the
// post schema's desk.preview). A location opens Presentation there, the document kept.
test('J62: "Used on N pages", and a location opens Presentation with the document', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await context.route(`${SITE}/**`, (route) => route.fulfill({contentType: 'text/html', body: standIn(new URL(route.request().url()).pathname)}))
  await page.goto(t.docPath('post', 'post-01'))
  await signInIfAsked(page)
  await t.settle(page)
  const banner = page.locator('.locations-banner')
  await expect(banner.getByRole('button')).toHaveText('Used on 2 pages')
  await banner.getByRole('button').click()
  await expect(banner.getByRole('link')).toHaveText([/Fixture post 01\s*\/posts\/fixture-post-01/, /All posts\s*\//])

  await page.goto(t.docPath('author', 'author-alan'))
  await expect(banner.getByRole('button')).toHaveText(/^Used on \d+ pages$/)
  const count = Number((await banner.getByRole('button').textContent())!.match(/\d+/)![0])
  expect(count).toBeGreaterThan(1)
  await banner.getByRole('button').click()
  await expect(banner.getByRole('link')).toHaveCount(count)
  await expect(banner.getByRole('link').first()).toContainText('/authors/author-alan')
  // The referrers' pages are on the post schema's desk.preview origin, :3537
  // (fixtures/barkpark-schema/post.json): a lane on other preview ports can't open them.
  if (SITE === 'http://localhost:3537') {
    await banner.getByRole('link', {name: /\/posts\/fixture-post-01$/}).click()
    await expect(page).toHaveURL(/\/presentation\?preview=%2Fposts%2Ffixture-post-01&pane=author%3Bauthor-alan/)
    await expect(page.getByLabel('URL')).toHaveValue(`${SITE}/posts/fixture-post-01`)
    await expect(page.locator('.presentation-panel [id="name"]')).toHaveValue('Alan Turing')
  }

  // A type without pages has no banner (Sanity's resolver answers null for it).
  await page.goto(t.docPath('category', 'category-guide'))
  await t.settle(page)
  await expect(page.locator('[id="title"]')).toBeVisible()
  await expect(banner).toHaveCount(0)
})

test('@evidence J62: the locations banner, side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  for (const [type, id] of [['post', 'post-01'], ['author', 'author-alan']]) {
    await page.goto(t.docPath(type, id))
    await signInIfAsked(page)
    const banner = page.getByText(/^(Used on|Not used on)/).first()
    await banner.waitFor({timeout: 30_000})
    await page.waitForTimeout(1500)
    await banner.click()
    await page.waitForTimeout(800)
    await page.screenshot({path: `evidence/J62-${t.name}-${type}.png`})
  }
})
