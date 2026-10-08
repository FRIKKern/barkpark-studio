import {readFileSync} from 'node:fs'
import {expect, test, type BrowserContext, type Page} from '@playwright/test'
import {target} from '../rig/targets'

// B11 (Barkpark-native, ours only): closing the tab asks first while anything typed has
// not reached Barkpark: a field edit still batching, a Freeform canvas edit not yet
// saved, a canvas batch that failed. Once saved, the tab closes without asking.
const POST = 'post-05'
const NOTE = 'note-03'
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${NOTE}"`))!) as {title: string; label: string; body: unknown}
let blocks: unknown
test.afterEach(async ({}, info) => {
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
  await expect.poll(() => asked || page.isClosed()).toBe(true)
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
  await expect(page.locator('.pd-conflict')).toContainText('Could not save')
  await context.setOffline(false)
  expect(await closeAsks(page), 'canvas, failed batch').toBe(true)
  // Retry saves it; then the tab closes.
  await page.getByRole('button', {name: 'Retry'}).click()
  await expect(page.locator('.pd-status')).toHaveText('Saved')
  expect(await closeAsks(page), 'canvas, saved').toBe(false)
})
