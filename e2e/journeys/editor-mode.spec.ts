import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// FF3 evidence (Freeform side track, ours only): story is an Expectation type
// (lib/editor-mode.ts: alternative), so story-01 opens in Classic with a Classic ⇄
// Freeform toggle over one block list. Toggling is lossless: with no edit the
// block list is byte-equal and the rev unchanged after Classic → Freeform →
// Classic; a Classic edit changes only its bound block's value (server
// BoundFieldSync), never a free block or the order. Stills go to e2e/evidence/.
const ID = 'story-01'
const SUMMARY = 'A story whose fields live in its block list.'
const shot = (step: string) => `evidence/FF3-studio-${step}.png`
type Block = {id: string; type: string; fieldName?: string; value?: unknown}

const bp = async (path: string) => {
  const base = `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
  const res = await fetch(`${base}${path}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  return ((await res.json()) as {result: {_rev: string; blocks: Block[]}}).result
}
const stored = () => bp(`/v1/data/doc/${process.env.BARKPARK_DATASET}/story/${ID}?perspective=raw`)
const draftOrPublished = async () => (await bp(`/v1/data/doc/${process.env.BARKPARK_DATASET}/story/${ID}?perspective=drafts`))

test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio') await target(info).restore(ID, {summary: SUMMARY}, 'story')
})

test('@evidence FF3: per-type editor mode; Classic ⇄ Freeform is lossless', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Freeform has no Sanity reference (decision 0004)')
  const before = await stored()
  await page.goto(t.docPath('story', ID))
  await t.settle(page)
  const tabs = page.getByRole('tablist', {name: 'Views'})
  await expect(tabs.getByRole('tab', {name: 'Classic'})).toHaveAttribute('aria-selected', 'true') // an Expectation type opens in Classic
  await expect(t.field(page, 'summary')).toHaveValue(SUMMARY)
  await expect(t.field(page, 'kicker')).toHaveValue('Freeform fixture')
  await page.screenshot({path: shot('1-classic')})

  // Classic → Freeform → Classic, no edit: nothing is written.
  await tabs.getByRole('tab', {name: 'Freeform'}).click()
  const canvas = page.locator('bp-paper-canvas')
  await expect(canvas).toContainText('A free paragraph the Classic form never touches.', {timeout: 20_000})
  await page.waitForTimeout(1500) // any mount-time op would have gone out by now
  await page.screenshot({path: shot('2-freeform')})
  await tabs.getByRole('tab', {name: 'Classic'}).click()
  await expect(t.field(page, 'summary')).toHaveValue(SUMMARY)
  const after = await stored()
  expect(after.blocks, 'block list byte-equal after the round trip').toEqual(before.blocks)
  expect(after._rev, 'no write').toBe(before._rev)

  // A Classic edit changes its bound block only.
  await t.field(page, 'summary').fill('Edited in Classic.')
  await expect.poll(async () => (await draftOrPublished()).blocks.find((b) => b.id === 'st-summary')?.value, {timeout: 10_000}).toBe('Edited in Classic.')
  const edited = (await draftOrPublished()).blocks
  expect(edited.map((b) => b.id), 'same blocks, same order').toEqual(before.blocks.map((b) => b.id))
  expect(edited.filter((b) => b.id !== 'st-summary'), 'every other block untouched').toEqual(before.blocks.filter((b) => b.id !== 'st-summary'))

  // …and Freeform shows it; back to Classic, still byte-equal.
  await tabs.getByRole('tab', {name: 'Freeform'}).click()
  // Bound blocks draw as field inputs in the canvas: the edit is in one's value.
  const values = () => canvas.locator('input, textarea').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
  await expect.poll(values, {timeout: 20_000}).toContain('Edited in Classic.')
  await page.waitForTimeout(1500)
  await page.screenshot({path: shot('3-freeform-after-classic-edit')})
  await tabs.getByRole('tab', {name: 'Classic'}).click()
  expect((await draftOrPublished()).blocks).toEqual(edited)
})
