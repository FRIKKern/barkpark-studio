import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, reveal} from '../rig/targets'

// J50 evidence, both studios: the backend goes away mid-session. A list that can't
// load says so in its pane ("Could not fetch list items", Retry, retry count), a doc
// pane waits in its loading state, and "Trying to connect…" shows after 2 s; when the
// backend is back, Retry fills the pane. Ours only: a pane that crashes shows its own
// card and the rest keep working (Sanity: the whole tool shows "The structure tool
// crashed"). Stills in e2e/evidence/J50-*.
const shot = (name: string, step: string) => `evidence/J50-${step}-${name}.png`
test.setTimeout(120_000)

async function backendDown(page: Page, name: string) {
  // Sanity reads its API from the browser; ours goes through this server's RPC.
  const down = name === 'sanity' ? /api\.sanity\.io|apicdn\.sanity\.io/ : /\/_serverFn\/|\/api\/(listen|presence)/
  await page.route(down, (r) => r.fulfill({status: 503, contentType: 'application/json', body: '{"error":"backend down"}'}))
  return () => page.unroute(down)
}

test('@evidence J50: backend down — list error card + Retry, doc pane waits, "Trying to connect…"', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)

  // 1. The list can't load: its pane says so, retries by itself, offers Retry.
  let up = await backendDown(page, t.name)
  await page.getByRole('link', {name: 'Post'}).first().click()
  await expect(page.getByText('Could not fetch list items')).toBeVisible({timeout: 10_000})
  await expect(page.getByText('Trying to connect…')).toBeVisible({timeout: 10_000})
  await page.waitForTimeout(2500)
  await page.screenshot({path: shot(t.name, '1-list-down')})

  // 2. Back up: Retry fills the list.
  await up()
  await page.getByRole('button', {name: 'Retry'}).click()
  await expect(t.listItem(page, 'post-01')).toBeVisible({timeout: 15_000})
  await expect(page.getByText('Trying to connect…')).toBeHidden({timeout: 15_000})
  await page.screenshot({path: shot(t.name, '2-list-back')})

  // 3. A doc opened while down: the pane waits in its loading state, the toast says why.
  up = await backendDown(page, t.name)
  await (await reveal(t.listItem(page, 'post-02'))).click()
  await expect(page.getByText('Trying to connect…')).toBeVisible({timeout: 10_000})
  await page.screenshot({path: shot(t.name, '3-doc-down')})
  await up()
  await expect(t.field(page, 'title')).toHaveValue('Fixture post 02', {timeout: 20_000})
  await expect(page.getByText('Trying to connect…')).toBeHidden({timeout: 15_000})
  await page.screenshot({path: shot(t.name, '4-doc-back')})

  // 4. Ours: a pane that crashes keeps to itself.
  if (t.name === 'studio') {
    await page.evaluate(() => ((window as {__crashPane?: string}).__crashPane = 'doc:post-03'))
    await t.listItem(page, 'post-03').click()
    const card = page.locator('[data-pane-crashed]')
    await expect(card).toContainText('Could not render the document editor')
    await expect(t.listItem(page, 'post-04')).toBeVisible()
    await page.screenshot({path: shot(t.name, '5-crash')})
    await page.evaluate(() => delete (window as {__crashPane?: string}).__crashPane)
    await card.getByRole('button', {name: 'Retry'}).click()
    await expect(t.field(page, 'title')).toHaveValue('Fixture post 03')
  }
})
