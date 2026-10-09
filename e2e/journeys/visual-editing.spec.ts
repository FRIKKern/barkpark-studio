import {expect, test} from '@playwright/test'
import {bpMutate, closeAndSettle, signInIfAsked, target} from '../rig/targets'
import {median, recordFeel} from '../rig/feel'

// Presentation's visual editing (J59 click to edit, J60 live preview, J63 drafts vs
// published, J64 sharing a draft), apart from presentation.spec.ts so CI's two shards stay under budget.
// Ours previews reference/preview-site from Barkpark on :3537.
const SITE = 'http://localhost:3537'

// J60 + J63 on a stand-in that renders what the studio sends: the title of the
// document it is told about, and the perspective it is asked to show.
const echoSite = `<!doctype html><h1 id="t">Fixture post 01</h1><p id="p">drafts</p>
<script>
  const post = (m) => parent.postMessage({bp: 'preview', ...m}, '*')
  post({type: 'hello'})
  post({type: 'location', url: location.pathname})
  post({type: 'documents', documents: [{_id: 'post-01', _type: 'post'}]})
  addEventListener('message', (e) => {
    if (e.data?.bp !== 'studio') return
    if (e.data.type === 'doc' && e.data.doc?._id?.endsWith('post-01')) document.getElementById('t').textContent = e.data.doc.title
    if (e.data.type === 'perspective') document.getElementById('p').textContent = e.data.perspective
  })
</script>`

test('J60 + J63: typing reaches the page at once, focus stays; the page shows the perspective the panel does', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await context.route(`${SITE}/**`, (route) => route.fulfill({contentType: 'text/html', body: echoSite}))
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const site = page.frameLocator('iframe')
  const title = page.locator('.presentation-panel [id="title"]')
  await expect(title).toHaveValue('Fixture post 01')
  await expect(site.locator('#p')).toHaveText('drafts')

  // J60: each key is on the page before the save goes out (the editor's cache, not the
  // server); the caret never leaves the field.
  await title.click()
  await title.press('End')
  const times: number[] = []
  for (const [i, ch] of [...' live'].entries()) {
    const t0 = Date.now()
    await page.keyboard.type(ch)
    await expect(site.locator('#t')).toHaveText(`Fixture post 01${' live'.slice(0, i + 1)}`, {useInnerText: true})
    times.push(Date.now() - t0)
  }
  recordFeel('F4', median(times), 'J60 typed → preview page')
  expect(median(times), 'typed edit reaches the preview (median)').toBeLessThan(300)
  await expect(title).toBeFocused()

  // J63: the panel's Published chip shows the published page; Draft brings drafts back.
  await page.locator('.presentation-panel').getByRole('button', {name: /^Published/}).first().click()
  await expect(page).toHaveURL(/perspective=published/)
  await expect(site.locator('#p')).toHaveText('published')
  await page.locator('.presentation-panel').getByRole('button', {name: /^Draft/}).first().click()
  await expect(site.locator('#p')).toHaveText('drafts')
  await closeAndSettle(page)
  await t.resetDoc('post-01', 'post')
})

test('@local J60 + J63: the Barkpark site follows typing live, and Published / Draft', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const site = page.frameLocator('iframe')
  const h1 = site.getByRole('heading', {level: 1})
  await expect(h1).toHaveText('Fixture post 01')
  const title = page.locator('.presentation-panel [id="title"]')
  await title.click()
  await title.press('End')
  await page.keyboard.type(' live')
  await expect(h1).toHaveText('Fixture post 01 live', {timeout: 1000})
  await expect(title).toBeFocused()
  // Saved, then the published page still has the old title, the draft the new.
  await expect(page.locator('.doc-footer .save-state')).toHaveText(/Saved|Edited/, {timeout: 10_000})
  await page.locator('.presentation-panel').getByRole('button', {name: /^Published/}).first().click()
  await expect(h1).toHaveText('Fixture post 01')
  await page.locator('.presentation-panel').getByRole('button', {name: /^Draft/}).first().click()
  await expect(h1).toHaveText('Fixture post 01 live')
  // Published: the published page catches up (Barkpark's listen stream).
  await page.locator('.presentation-panel .doc-footer').getByRole('button', {name: 'Publish'}).click()
  await page.locator('.presentation-panel').getByRole('button', {name: /^Published/}).first().click()
  await expect(h1).toHaveText('Fixture post 01 live')
  await closeAndSettle(page)
  await t.resetDoc('post-01', 'post')
})

test('@local J64 sharing: on mints a link (QR, copy), the page outside shows the draft; off ends it', async ({page, context, browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "the check runs on ours; the reference robot token can't share in Sanity either")
  await t.prepare(context)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const title = page.locator('.presentation-panel [id="title"]')
  await title.click()
  await title.press('End')
  await page.keyboard.type(' (draft)')
  await expect(page.locator('.doc-footer .save-state')).toHaveText(/Saved/, {timeout: 10_000})

  await page.getByRole('button', {name: 'Share this preview'}).click()
  const share = page.getByRole('dialog', {name: 'Share this preview'})
  await expect(share.getByRole('switch')).toBeEnabled()
  // A link left live by an earlier run (its token is in another browser): off first.
  if (await share.getByRole('switch').isChecked()) {
    await share.getByRole('switch').click()
    await expect(share.getByRole('switch')).not.toBeChecked()
  }
  await share.getByRole('switch').click()
  await expect(share.getByRole('switch')).toBeChecked()
  await expect(share.getByRole('img', {name: /^A QR Code which encodes the URL: /})).toBeVisible()
  await share.getByRole('button', {name: 'Copy preview link'}).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(new RegExp(`^${SITE}/posts/fixture-post-01\\?bp-share=`))

  // Anyone with the link: the page, with the draft.
  const outside = await (await browser.newContext()).newPage()
  await outside.goto(link)
  await expect(outside.getByRole('heading', {level: 1})).toHaveText('Fixture post 01 (draft)')
  await expect(outside.getByText('Preview of unpublished changes')).toBeVisible()

  // Off: the link stops working.
  await share.getByRole('switch').click()
  await expect(share.getByRole('switch')).not.toBeChecked()
  await outside.reload()
  await expect(outside.getByText('This preview link has expired or was turned off.')).toBeVisible()
  await expect(outside.getByRole('heading', {level: 1})).toHaveText('Fixture post 01')
  await closeAndSettle(page)
  await t.resetDoc('post-01', 'post')
})

// J59 on a stand-in: a click on a marked value asks the studio to edit it; the
// Edit switch (and Alt, held) turns the overlay off.
const clickSite = `<!doctype html><h1>Fixture post 01</h1><p id="x">Short excerpt</p><p id="o">on</p>
<script>
  const post = (m) => parent.postMessage({bp: 'preview', ...m}, '*')
  post({type: 'hello'})
  post({type: 'location', url: location.pathname})
  document.getElementById('x').onclick = () => post({type: 'edit', doc: {type: 'post', id: 'post-01'}, path: 'excerpt'})
  addEventListener('message', (e) => e.data?.bp === 'studio' && e.data.type === 'overlays' && (document.getElementById('o').textContent = e.data.enabled ? 'on' : 'off'))
</script>`

test('J59: clicking a value opens its field in the panel; Edit turns the overlay off', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await context.route(`${SITE}/**`, (route) => route.fulfill({contentType: 'text/html', body: clickSite}))
  await page.goto('/presentation?preview=/')
  await signInIfAsked(page)
  const site = page.frameLocator('iframe')
  await expect(site.locator('#o')).toHaveText('on')
  await site.locator('#x').click()
  await expect(page).toHaveURL(/pane=post%3Bpost-01%2Cpath%3Dexcerpt/)
  await expect(page.locator('.presentation-panel [id="excerpt"]')).toBeFocused()

  const edit = page.getByRole('switch', {name: 'Edit'})
  await edit.click()
  await expect(site.locator('#o')).toHaveText('off')
  await page.keyboard.down('Alt')
  await expect(site.locator('#o')).toHaveText('on')
  await page.keyboard.up('Alt')
  await expect(site.locator('#o')).toHaveText('off')
})

test('@local J59: the Barkpark page outlines its values; a click edits that field', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const site = page.frameLocator('iframe')
  const excerpt = site.getByText('Short excerpt for post 1.')
  await expect(excerpt).toHaveAttribute('data-bp-edit', 'post:post-01:excerpt')
  await excerpt.hover()
  await expect(site.getByText('Fixture post 01', {exact: true}).last()).toBeVisible()
  await excerpt.click()
  await expect(page.locator('.presentation-panel [id="excerpt"]')).toBeFocused()
  // Edit off: the page is a page again.
  await page.getByRole('switch', {name: 'Edit'}).click()
  await site.getByRole('link', {name: 'Alan Turing'}).click()
  await expect(page.getByLabel('URL')).toHaveValue(`${SITE}/authors/author-alan`)
})

test('@evidence J59: hover outline and click-to-edit, side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-01')
  await signInIfAsked(page)
  const site = page.frameLocator('iframe')
  await site.getByRole('heading', {name: /Fixture post 01/, level: 1}).waitFor({timeout: 30_000})
  await page.waitForTimeout(2000)
  await site.getByText('Short excerpt for post 1.').hover()
  await page.waitForTimeout(700)
  await page.screenshot({path: `evidence/J59-${t.name}-1-hover.png`})
  await site.getByText('Short excerpt for post 1.').click()
  await page.waitForTimeout(2000)
  await page.screenshot({path: `evidence/J59-${t.name}-2-click.png`})
})

// J60 (F4): someone else's edit to a document on the page is on the preview as soon
// as Barkpark's listen frame arrives; the page patches itself from the frame (and
// from the studio's own copy when the panel holds the document), never waiting on a
// second read.
test('@local J60 F4: a remote edit reaches the preview page within F4', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.goto('/presentation?preview=/posts/fixture-post-02')
  await signInIfAsked(page)
  await page.frameLocator('iframe').getByRole('heading', {name: 'Fixture post 02', level: 1}).waitFor()
  const site = page.frames().find((f) => f.url().startsWith(SITE))!
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    const text = `Remote ${i} ${Date.now()}`
    await site.evaluate((want) => {
      ;(window as unknown as {seen: Promise<number>}).seen = new Promise((done) => {
        const o = new MutationObserver(() => document.body.innerText.includes(want) && (o.disconnect(), done(performance.timeOrigin + performance.now())))
        o.observe(document.body, {subtree: true, childList: true, characterData: true})
      })
    }, text)
    const sent = Date.now()
    await bpMutate([{patch: {id: 'post-02', type: 'post', set: {excerpt: text}}}])
    times.push((await site.evaluate(() => (window as unknown as {seen: Promise<number>}).seen)) - sent)
  }
  recordFeel('F4', median(times), 'J60 remote write → preview page')
  expect(median(times), 'remote write → preview page (median, write round trip included)').toBeLessThan(300)
  await closeAndSettle(page)
  await t.resetDoc('post-02', 'post')
})

// J63, the navbar's perspective picker: Published for the whole studio (list,
// document read-only, Presentation's preview), kept across links; Drafts clears it.
test('J63: the navbar picker switches the studio to Published and back', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await context.route(`${SITE}/**`, (route) =>
    route.fulfill({contentType: 'text/html', body: `<p id="p">drafts</p><script>parent.postMessage({bp: 'preview', type: 'hello'}, '*'); addEventListener('message', (e) => e.data?.type === 'perspective' && (document.getElementById('p').textContent = e.data.perspective))</script>`}),
  )
  await page.goto(t.listPath('post'))
  await signInIfAsked(page)
  await t.settle(page)
  const picker = page.getByRole('button', {name: 'Perspective'})
  await expect(picker).toHaveText('Drafts')
  await picker.click()
  await page.getByRole('menuitemradio', {name: 'Published'}).click()
  await expect(page).toHaveURL(/\/structure\/post\?perspective=published$/)
  await expect(picker).toHaveText('Published')
  await expect(page.locator('nav.navbar')).toHaveAttribute('data-perspective', 'published')

  // A link keeps it: the document opens published, read-only.
  await page.locator('a[href*=";post-01?perspective=published"]').click()
  await expect(page).toHaveURL(/post-01\?perspective=published$/)
  await expect(t.field(page, 'title')).not.toBeEditable()
  // And so does a tool: Presentation's preview shows the published page.
  await page.getByRole('navigation').getByRole('link', {name: 'Presentation'}).click()
  await expect(page).toHaveURL(/\/presentation\?perspective=published/)
  await expect(page.frameLocator('iframe').locator('#p')).toHaveText('published')

  await picker.click()
  await page.getByRole('menuitemradio', {name: 'Drafts'}).click()
  await expect(page).not.toHaveURL(/perspective=/)
  await expect(page.frameLocator('iframe').locator('#p')).toHaveText('drafts')
  await expect(picker).toHaveText('Drafts')
})
