import {readFileSync} from 'node:fs'
import {expect, test, type BrowserContext, type Page} from '@playwright/test'
import {target, closeAndSettle} from '../rig/targets'

// B11 (Barkpark-native, ours only): closing the tab asks first while anything typed has
// not reached Barkpark: a field edit still batching, a Freeform canvas edit not yet
// saved, a canvas batch that failed. Once saved, the tab closes without asking.
const POST = 'post-05'
const NOTE = 'note-03'
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${NOTE}"`))!) as {title: string; label: string; body: unknown}
let blocks: unknown
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  const t = target(info)
  if (t.name !== 'studio') return
  await t.resetDoc(POST, 'post')
  if (blocks) await t.restore(NOTE, {title: SEED.title, label: SEED.label, body: SEED.body, blocks}, 'note')
})

/** Close the tab the way a person does; whether the browser asked first. */
async function closeAsks(page: Page) {
  let asked = false
  page.once('dialog', (d) => ((asked = d.type() === 'beforeunload'), void d.dismiss()))
  await page.close({runBeforeUnload: true})
  await expect.poll(() => asked || page.isClosed(), {intervals: [50]}).toBe(true)
  return asked
}
async function open(ctx: BrowserContext, path: string, settle: (p: Page) => Promise<void>) {
  const page = await ctx.newPage()
  await page.goto(path)
  await settle(page)
  return page
}

test('@local B11: closing the tab with unsaved or failed edits asks first', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: we batch writes')
  test.setTimeout(45_000)
  // A field edit still batching (one write per 750 ms): asks. Saved: closes.
  let page = await open(context, t.docPath('post', POST), t.settle)
  await t.field(page, 'title').click()
  await page.keyboard.type(' B11')
  expect(await closeAsks(page), 'typed, closed at once').toBe(true)
  await expect(page.locator('.doc-footer [role=status]')).toHaveText(/^(Saved|Edited)/)
  expect(await closeAsks(page), 'after the save').toBe(false)
  expect(page.isClosed()).toBe(true)

  // A canvas edit not yet saved: asks.
  blocks = await t.docValue(NOTE, 'blocks', 'note')
  page = await open(context, t.docPath('note', NOTE), t.settle)
  const canvas = page.locator('bp-paper-canvas')
  await canvas.getByText('Third note, second paragraph.').click()
  await page.waitForTimeout(100) // a person's beat: the editor reads the click's caret
  await page.keyboard.press('End')
  await context.setOffline(true)
  await page.keyboard.type(' unsaved')
  expect(await closeAsks(page), 'canvas, pending').toBe(true)
  // Its batch fails (offline): the canvas says so, and closing still asks.
  await expect(page.locator('.pd-status')).toHaveText(/^Offline/)
  expect(await closeAsks(page), 'canvas, waiting for the network').toBe(true)
  // Back online it goes again by itself; then the tab closes.
  await context.setOffline(false)
  await expect(page.locator('.pd-status')).toHaveText('Saved', {timeout: 10_000})
  expect(await closeAsks(page), 'canvas, saved').toBe(false)
})

// A save on its way when the tab closes: the page's own request dies with it, so what
// the page sends as it goes carries that save too (it carried only what was typed after).
test('B11: closing the tab while a save is on its way still saves it', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's loses it and doesn't ask")
  const page = await open(context, t.docPath('post', POST), t.settle)
  // Held: the save stays on its way until the page goes.
  const ours = (r: {method(): string; postData(): string | null}) => r.method() === 'POST' && (r.postData() ?? '').includes(POST)
  await page.route('**/_serverFn/**', (r) => (ours(r.request()) ? undefined : r.continue()))
  const title = t.field(page, 'title')
  const was = await title.inputValue()
  const sent = page.waitForRequest((r) => r.url().includes('_serverFn') && ours(r))
  await title.fill(`${was} kept`)
  await sent
  page.once('dialog', (d) => void d.accept())
  await page.close({runBeforeUnload: true})
  await expect.poll(() => t.docValue(POST, 'title', 'post'), {timeout: 10_000}).toBe(`${was} kept`)
})

// The race itself, 20 times: typed, closed at once, the word lands every time (3 of 24
// closes lost it before). @local: 20 page loads are over CI's budget; the held-save
// test above is its CI lock.
test('@local B11: 20 tab closes right after typing lose nothing', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's loses the last keys on close")
  test.setTimeout(180_000)
  // Each request through the test's proxy: a save takes a moment longer on its way, so one
  // is often still going as the tab closes, and the close kills it.
  await context.route('**/_serverFn/**', (r) => r.continue())
  const lost: string[] = []
  for (let i = 0; i < 20; i++) {
    const page = await open(context, t.docPath('post', POST), t.settle)
    await t.field(page, 'title').click()
    await page.keyboard.press('ControlOrMeta+ArrowRight')
    const word = ` w${i}`
    await page.keyboard.type(word, {delay: [10, 20, 30][i % 3]})
    page.once('dialog', (d) => void d.accept())
    await page.close({runBeforeUnload: true})
    const landed = await expect.poll(async () => String(await t.docValue(POST, 'title', 'post')).endsWith(word), {timeout: 8_000}).toBe(true).then(() => true, () => false)
    if (!landed) lost.push(word)
  }
  expect(lost).toEqual([])
})
