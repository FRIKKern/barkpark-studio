import {expect, test, type Browser, type Page, type TestInfo} from '@playwright/test'
import {existsSync, rmSync} from 'node:fs'
import {target} from '../rig/targets'

// The Barkpark-native journeys side by side with Barkpark's own LiveView Studio (their
// reference), on the same dataset: one still of each side per step, named
// evidence/<B row>-sbs-<step>-{studio,liveview}.png, for the quality owner's sign-off.
// Needs the owner's LiveView test account (LIVEVIEW_TEST_EMAIL / _PASSWORD in .env) and
// an e2e-* dataset; never production. Read-only on both sides except B11, which types into
// post-02's title and puts it back.
const LV = process.env.LIVEVIEW_TEST_EMAIL
const DATASET = process.env.BARKPARK_DATASET!
const lvBase = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/d/${DATASET}/studio`
const STATE = 'test-results/liveview-session.json'
const still = (row: string, step: string, side: 'studio' | 'liveview') => `evidence/${row}-sbs-${step}-${side}.png`

test.skip(!LV || !process.env.LIVEVIEW_TEST_PASSWORD, 'needs the LiveView test account in .env')
test.skip(!/^e2e-/.test(DATASET ?? ''), 'side by side runs on an e2e-* dataset only')
test.use({viewport: {width: 1440, height: 900}})
test.describe.configure({timeout: 90_000})
// The signed-in session is a credential: never left on disk after the run.
test.afterAll(() => rmSync(STATE, {force: true}))

/** Recorded on the test and printed, so a run's log carries the finding. */
const note = (info: TestInfo, a: {type: string; description: string}) => (info.annotations.push(a), console.log(`[${a.type}] ${a.description}`))

/** A signed-in LiveView page (one sign-in per worker, kept in test-results). */
async function liveView(browser: Browser): Promise<Page> {
  if (!existsSync(STATE)) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${process.env.BARKPARK_URL}/login`)
    await page.locator('input[type=email], input[name*=email]').first().fill(LV!)
    await page.locator('input[type=password]').first().fill(process.env.LIVEVIEW_TEST_PASSWORD!)
    await page.locator('button[type=submit], input[type=submit]').first().click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'))
    await ctx.storageState({path: STATE})
    await ctx.close()
  }
  const ctx = await browser.newContext({storageState: STATE, viewport: {width: 1440, height: 900}})
  return ctx.newPage()
}
/** LiveView has no hydration mark: wait for its socket to join, then for the pane to draw. */
const lvGo = async (page: Page, path: string) => {
  await page.goto(lvBase() + path)
  await page.locator('[data-phx-main].phx-connected, .phx-connected').first().waitFor()
  await page.waitForTimeout(800)
}

// B01 needs a workspace whose Studio language is nb-NO (studio-parity-nb, seeded like the
// lanes): BARKPARK_WORKSPACE=studio-parity-nb BARKPARK_DATASET=e2e-nb … -g B01.
test('@evidence B01: Norwegian (nb-NO) Studio UI, both studios in one nb-NO workspace', async ({page, browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  const res = await fetch(`${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/workspace/locale`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  test.skip(((await res.json()) as {locale?: string}).locale !== 'nb-NO', "the workspace's Studio language is not nb-NO")
  const lv = await liveView(browser)
  for (const [step, ours, theirs] of [
    ['1-list', t.listPath('post'), '/post'],
    ['2-post', t.docPath('post', 'post-01'), '/post/post-01'],
    ['3-volume', t.docPath('volume', 'volume-03'), '/volume/volume-03'],
    ['4-media', '/media', '/media'],
  ] as const) {
    await page.goto(ours)
    await t.settle(page)
    await page.waitForTimeout(800)
    await page.screenshot({path: still('B01', step, 'studio')})
    await lvGo(lv, theirs)
    await lv.screenshot({path: still('B01', step, 'liveview')})
  }
  // Relative times: a list row's status tooltip (ours); LiveView prints them in the row.
  await page.goto(t.listPath('post'))
  await t.settle(page)
  await page.getByTestId('row-status').first().hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.screenshot({path: still('B01', '5-ago', 'studio')})
})

test('@evidence B02: switch workspace / project / dataset', async ({page, browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  const lv = await liveView(browser)
  await page.goto(t.listPath('post'))
  await t.settle(page)
  await page.getByRole('button', {name: /^Workspace .* Switch$/}).click()
  await expect(page.getByRole('dialog', {name: 'Switch workspace, project or dataset'})).toBeVisible()
  await page.screenshot({path: still('B02', '1-switcher', 'studio')})
  await lvGo(lv, '/post')
  await lv.getByRole('button', {name: /^Switch scope/}).click()
  await lv.waitForTimeout(600)
  await lv.screenshot({path: still('B02', '1-switcher', 'liveview')})
})

test('@evidence B03: list rows ticked for a bulk action', async ({page, browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  const lv = await liveView(browser)
  await page.goto(t.listPath('note'))
  await t.settle(page)
  await page.getByRole('checkbox', {name: 'Select Fixture note 03'}).check()
  await page.getByRole('checkbox', {name: 'Select Fixture note 02'}).check()
  await page.screenshot({path: still('B03', '1-ticked', 'studio')})
  await lvGo(lv, '/note')
  await lv.getByText('Fixture note 03').hover()
  await lv.waitForTimeout(400)
  await lv.screenshot({path: still('B03', '1-hover', 'liveview')})
  note(info, {type: 'liveview selection', description: String(await lv.locator('input[type=checkbox]:visible').count())})
})

test('@evidence B04 B05 B06: volume-01 and volume-03, both tabs', async ({page, browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  const lv = await liveView(browser)
  // Tall windows: each form whole in one still, no inner scroll.
  for (const p of [page, lv]) await p.setViewportSize({width: 1440, height: 3600})
  for (const id of ['volume-01', 'volume-03']) {
    await page.goto(t.docPath('volume', id))
    await t.settle(page)
    await lvGo(lv, `/volume/${id}`)
    for (const tab of ['Main', 'Metadata']) {
      await page.getByRole('tab', {name: tab}).click()
      await lv.getByText(tab, {exact: true}).first().click()
      await lv.waitForTimeout(600)
      await page.screenshot({path: still('B04', `${id}-${tab.toLowerCase()}`, 'studio')})
      await lv.screenshot({path: still('B04', `${id}-${tab.toLowerCase()}`, 'liveview')})
    }
  }
  // B05: the Thema tree, searched for a code; B06: the blurb's languages.
  await page.goto(t.docPath('volume', 'volume-01'))
  await t.settle(page)
  await lvGo(lv, '/volume/volume-01')
  for (const p of [page, lv]) await p.setViewportSize({width: 1440, height: 900})
  // Typed, as a person would (LiveView searches on keyup).
  for (const p of [page, lv]) await p.getByPlaceholder('Search codes or labels…').first().pressSequentially('YFB', {delay: 60})
  await page.waitForTimeout(800)
  await lv.waitForTimeout(800)
  await page.locator('.codelist-tree-field').screenshot({path: still('B05', '1-search', 'studio')})
  await lv.getByPlaceholder('Search codes or labels…').first().locator('xpath=ancestor::*[self::fieldset or self::div][3]').screenshot({path: still('B05', '1-search', 'liveview')})
  await page.locator('.field').filter({has: page.getByRole('tablist', {name: 'Blurb'})}).screenshot({path: still('B06', '1-blurb', 'studio')})
  await lv.getByText('Blurb', {exact: false}).first().locator('xpath=ancestor::fieldset[1]').screenshot({path: still('B06', '1-blurb', 'liveview')})
})

test('@evidence B07: unpublishing a referenced doc lists who refers to it', async ({page, browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  const lv = await liveView(browser)
  await page.goto(`${t.docPath('author', 'author-alan')}?perspective=published`)
  await t.settle(page)
  await page.getByRole('button', {name: 'Unpublish', exact: true}).click()
  await expect(page.getByRole('dialog', {name: 'Unpublish document?'})).toBeVisible()
  await page.screenshot({path: still('B07', '1-guard', 'studio')})
  await page.keyboard.press('Escape')
  await lvGo(lv, '/author/author-alan')
  await lv.getByRole('button', {name: 'Unpublish'}).click()
  await lv.waitForTimeout(800)
  await lv.screenshot({path: still('B07', '1-guard', 'liveview')})
  // Never unpublish here: close whatever asked.
  await lv.keyboard.press('Escape')
})

test('@evidence B08: media library', async ({page, browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  const lv = await liveView(browser)
  await page.goto('/media')
  await t.settle(page)
  await page.waitForTimeout(800)
  await page.screenshot({path: still('B08', '1-library', 'studio')})
  await lvGo(lv, '/media')
  await lv.screenshot({path: still('B08', '1-library', 'liveview')})
  // The kind filter: Images on both.
  await page.getByRole('navigation', {name: 'Folders'}).getByRole('button', {name: /^Images/}).click()
  await page.waitForTimeout(800)
  await page.screenshot({path: still('B08', '2-images', 'studio')})
  await lv.getByText('Images', {exact: true}).first().click()
  await lv.waitForTimeout(800)
  await lv.screenshot({path: still('B08', '2-images', 'liveview')})
  // Sort: oldest first on both.
  await page.getByLabel('Sort').selectOption('created-asc')
  await page.waitForTimeout(800)
  await page.screenshot({path: still('B08', '3-oldest', 'studio')})
  await lv.locator('select').filter({hasText: 'Newest first'}).first().selectOption({label: 'Oldest first'})
  await lv.waitForTimeout(1500)
  await lv.screenshot({path: still('B08', '3-oldest', 'liveview')})
  // List view on both.
  await page.getByRole('button', {name: 'List', exact: true}).click()
  await page.waitForTimeout(800)
  await page.screenshot({path: still('B08', '4-list', 'studio')})
  await lv.getByText('List', {exact: true}).first().click()
  await lv.waitForTimeout(1200)
  await lv.screenshot({path: still('B08', '4-list', 'liveview')})
  // The inspector: the first (oldest) image on both.
  await page.locator('.media-list tbody tr').first().getByRole('button').click()
  await page.waitForTimeout(1200)
  await page.screenshot({path: still('B08', '5-inspector', 'studio')})
  await lv.getByText(/\.png$/).first().click()
  await lv.waitForTimeout(1500)
  await lv.screenshot({path: still('B08', '5-inspector', 'liveview')})
})

test('@evidence B09: an author\'s Posts view', async ({page, browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  const lv = await liveView(browser)
  await page.goto(t.docPath('author', 'author-ada'))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Posts'}).click()
  await page.waitForTimeout(800)
  await page.screenshot({path: still('B09', '1-posts', 'studio')})
  await lvGo(lv, '/author/author-ada')
  await lv.getByText('Posts', {exact: true}).first().click()
  await lv.waitForTimeout(800)
  await lv.screenshot({path: still('B09', '1-posts', 'liveview')})
})

test('@evidence B10: a schema action\'s confirm and dry-run', async ({page, browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  const lv = await liveView(browser)
  await page.goto(t.docPath('volume', 'volume-01'))
  await t.settle(page)
  await t.docMenu(page).click()
  await page.screenshot({path: still('B10', '1-menu', 'studio')})
  const item = page.getByRole('menuitem', {name: 'Send to Bokbasen'})
  if (await item.count()) {
    await item.click()
    const dialog = page.getByRole('dialog', {name: 'Send to Bokbasen?'})
    await page.screenshot({path: still('B10', '2-confirm', 'studio')})
    await dialog.getByRole('button', {name: 'Confirm', exact: true}).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await page.screenshot({path: still('B10', '3-dryrun', 'studio')})
    await dialog.getByRole('button', {name: 'Cancel'}).click()
  }
  await lvGo(lv, '/volume/volume-01')
  const lvAction = lv.getByRole('button', {name: /Send to Bokbasen/})
  note(info, {type: 'liveview action button', description: String(await lvAction.count())})
  await lv.screenshot({path: still('B10', '1-menu', 'liveview')})
  if (await lvAction.count()) {
    await lvAction.first().click()
    await lv.waitForTimeout(800)
    await lv.screenshot({path: still('B10', '2-confirm', 'liveview')})
    const confirm = lv.getByRole('button', {name: /^Confirm|Run dry-run|Dry-run/})
    if (await confirm.count()) {
      await confirm.first().click()
      await lv.waitForTimeout(1500)
      await lv.screenshot({path: still('B10', '3-dryrun', 'liveview')})
    }
    await lv.keyboard.press('Escape')
  }
})

test('@evidence B11: closing the tab with an unsaved edit', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  // Both sides: type into a field, close at once, note whether the browser asks.
  const asks = async (page: Page, field: ReturnType<Page['locator']>) => {
    let asked = false
    page.on('dialog', (d) => ((asked = d.type() === 'beforeunload'), d.dismiss()))
    await field.click()
    await page.keyboard.type(' B11', {delay: 20})
    await page.close({runBeforeUnload: true})
    await page.waitForEvent('close', {timeout: 3000}).catch(() => {})
    return asked
  }
  const ours = await (await browser.newContext({baseURL: test.info().project.use.baseURL})).newPage()
  await ours.goto(t.docPath('post', 'post-02'))
  await t.settle(ours)
  const oursAsked = await asks(ours, t.field(ours, 'title'))
  const lv = await liveView(browser)
  await lvGo(lv, '/post/post-02')
  const lvAsked = await asks(lv, lv.locator('input[type=text]:visible').first())
  note(info, {type: 'B11 asks on close', description: JSON.stringify({studio: oursAsked, liveview: lvAsked})})
  await t.restore('post-02', {title: 'Fixture post 02'})
})
