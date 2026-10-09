import {readFileSync} from 'node:fs'
import {expect, test, type Page} from '@playwright/test'
import {target} from '../rig/targets'

// D21, after Barkdown's "Put the words back": a canvas save fails (here the network
// drops it), the card says the words are kept on this computer, the tab closes; on
// reopen the document offers them back, and one confirmed write puts them in.
const ID = 'note-01'
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${ID}"`))!) as {
  title: string
  label: string
  body: unknown
}
type Block = {id: string}
let before: Block[] | undefined
test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio' && before) await target(info).restore(ID, {title: SEED.title, label: SEED.label, body: SEED.body, blocks: before}, 'note')
})

const fieldBlock = (p: Page, label: string) =>
  p.locator('bp-paper-canvas .bp-canvas-field').filter({has: p.locator('.bp-canvas-field-label', {hasText: label})}).locator('input')
const isOps = (body: string | null) => !!body && body.includes('"ifRev"')

test('@local D21: a failed save keeps the words; reopening offers them back and puts them in', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  before = (await t.docValue(ID, 'blocks', 'note')) as Block[]
  const ctx = await browser.newContext()
  await t.prepare(ctx)
  try {
    const page = await ctx.newPage()
    await page.goto(t.docPath('note', ID))
    await t.settle(page)
    await expect(fieldBlock(page, 'Label')).toHaveValue(SEED.label, {timeout: 20_000})

    // The save never reaches Barkpark.
    await page.route('**/_serverFn/**', (route) => (isOps(route.request().postData()) ? route.abort('internetdisconnected') : route.continue()))
    await fieldBlock(page, 'Label').fill('Words that did not save')
    await expect(page.locator('.pd-conflict')).toContainText('Your words are kept on this computer.', {timeout: 15_000})
    await page.screenshot({path: 'evidence/D21-1-failed.png'})
    await page.close() // the tab goes, the words were never saved
    expect(await t.docValue(ID, 'label', 'note')).toBe(SEED.label)

    const again = await ctx.newPage()
    await again.goto(t.docPath('note', ID))
    await t.settle(again)
    const offer = again.locator('[data-kept-words]')
    await expect(offer).toContainText('Words were not saved:', {timeout: 20_000})
    await again.screenshot({path: 'evidence/D21-2-offered.png'})
    await offer.getByRole('button', {name: 'Put the words back'}).click()
    await offer.getByRole('button', {name: 'Confirm: replace this text with the kept words'}).click()
    await expect(again.getByText('The kept words are back in the document.')).toBeVisible()
    await expect(offer).toHaveCount(0)
    await expect.poll(() => t.docValue(ID, 'label', 'note'), {timeout: 15_000}).toBe('Words that did not save')
    await expect(fieldBlock(again, 'Label')).toHaveValue('Words that did not save')

    // Offered once: the next open has nothing to offer.
    await again.reload()
    await t.settle(again)
    await expect(fieldBlock(again, 'Label')).toHaveValue('Words that did not save', {timeout: 20_000})
    await expect(again.locator('[data-kept-words]')).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})
