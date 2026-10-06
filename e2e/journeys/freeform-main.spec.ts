import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// D01 (Freeform side track, ours only): note is Freeform-main (lib/editor-mode.ts), so
// note-01 opens in the canvas. Its bound fields (title, label) sit in place as field
// blocks, titled like the Classic form; typing in a free block or a field block saves
// through the canvas (EMBED-CONTRACT HTTP host) and Barkpark projects the field back.
// Barkpark's LiveView Studio is the reference; it needs a member session we don't have
// here, so stills are ours only (e2e/evidence/D01-*).
const ID = 'note-01'
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${ID}"`))!) as {
  title: string
  label: string
  body: unknown
}
const shot = (step: string) => `evidence/D01-${step}-studio.png`
type Block = {id: string; type: string; fieldName?: string; value?: unknown; content?: {value?: string}[]}
const read = async () => {
  const base = `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
  const res = await fetch(`${base}/v1/data/doc/${process.env.BARKPARK_DATASET}/note/${ID}?perspective=drafts`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  return ((await res.json()) as {result: {title: string; label: string; blocks: Block[]}}).result
}

// The block list as the test found it: after a canvas save the doc stores its blocks.
let before: Block[] | undefined
test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio' && before) await target(info).restore(ID, {title: SEED.title, label: SEED.label, body: SEED.body, blocks: before}, 'note')
})

test('@local D01: a Freeform-main doc opens in the canvas, bound fields as titled field blocks', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  before = (await read()).blocks
  expect(before.map((b) => b.id), 'seeded note-01').toEqual(['synth-f-title-0', 'synth-f-label-1', 'n01h', 'n01p'])
  await page.goto(t.docPath('note', ID))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')
  await expect(page.getByRole('tab', {name: 'Freeform'})).toHaveAttribute('aria-selected', 'true')
  await expect(canvas.getByText('A note opens in the canvas')).toBeVisible()
  // Bound fields, in layout order, before the free blocks, titled and holding their values.
  const fields = canvas.locator('.bp-canvas-field')
  await expect(fields).toHaveCount(2)
  await expect(fields.nth(0).locator('.bp-canvas-field-label')).toHaveText('Title')
  await expect(fields.nth(0).locator('input')).toHaveValue(SEED.title)
  await expect(fields.nth(1).locator('.bp-canvas-field-label')).toHaveText('Label')
  await expect(fields.nth(1).locator('input')).toHaveValue(SEED.label)
  await page.screenshot({path: shot('1-open')})

  // A field block saves into its field; the pane title follows.
  await fields.nth(0).locator('input').fill('Fixture note 01 renamed')
  await expect.poll(async () => (await read()).title, {timeout: 10_000}).toBe('Fixture note 01 renamed')
  await expect(page.locator('.doc-title-bar')).toContainText('Fixture note 01 renamed', {timeout: 10_000})
  await expect(page.locator('.pd-conflict')).toHaveCount(0)
  await page.screenshot({path: shot('2-edited')})
})

// Typing in a free block: on a fresh canvas the first keystroke after a click into a
// paragraph can replace the leading bound field block (here: the title) with a new
// paragraph — 3 runs in 4, no server update involved. Canvas bug task-f24549dea0618da2;
// on until it is fixed upstream, then this becomes part of the test above.
test.fixme('@local D01: typing in a free block saves it and keeps the field blocks', async ({page}, info) => {
  const t = target(info)
  before = (await read()).blocks
  await page.goto(t.docPath('note', ID))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')
  await canvas.getByText('A note opens in the canvas').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Typed here.')
  await expect.poll(async () => JSON.stringify((await read()).blocks.find((b) => b.id === 'n01p')), {timeout: 10_000}).toContain('Typed here.')
  expect((await read()).blocks.map((b) => b.id)).toEqual(['synth-f-title-0', 'synth-f-label-1', 'n01h', 'n01p'])
})
