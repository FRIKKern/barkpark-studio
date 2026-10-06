import {readFileSync} from 'node:fs'
import {expect, test, type Page} from '@playwright/test'
import {installProbes, stats, typeAndMeasure} from '../rig/feel'
import {target} from '../rig/targets'

// D10 (Freeform side track, ours only). (1) In note-01's canvas: æøå typed straight,
// Norwegian dead keys (´ then e → é, ¨ then o → ö) and an IME composition (Japanese),
// each driven through Chrome's composition events (CDP Input.imeSetComposition +
// insertText, what a dead key or an IME does); the server holds the text as typed.
// (2) A 500-block note: keystroke → paint (F1) at the end of it. Numbers go to the
// annotations; the run's dataset gets the big note for the test and loses it after.
const ID = 'note-01'
const BIG = `note-d10-big-${Date.now().toString(36)}` // fresh each run: a reused id carries its delete in its history
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${ID}"`))!) as {title: string; label: string; body: unknown}
type Block = {id: string; content?: {value?: string}[]}
const base = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const mutate = (mutations: unknown[]) =>
  fetch(`${base()}/v1/data/mutate/${process.env.BARKPARK_DATASET}`, {
    method: 'POST',
    headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`, 'content-type': 'application/json'},
    body: JSON.stringify({mutations}),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`mutate → ${r.status} ${await r.text()}`)
  })

let before: Block[] | undefined
test.afterEach(async ({}, info) => {
  if (target(info).name !== 'studio') return
  if (before) await target(info).restore(ID, {title: SEED.title, label: SEED.label, body: SEED.body, blocks: before}, 'note')
  await mutate([{delete: {id: BIG, type: 'note', force: true}}]).catch(() => {})
})

/** What a dead key or an IME does in Chrome: compose `steps`, then commit `text`. */
async function compose(page: Page, steps: string[], text: string) {
  const cdp = await page.context().newCDPSession(page)
  for (const s of steps) await cdp.send('Input.imeSetComposition', {text: s, selectionStart: s.length, selectionEnd: s.length})
  await cdp.send('Input.insertText', {text})
  await cdp.detach()
}

test('@local D10: Norwegian letters, dead keys and IME in the canvas; a 500-block doc keeps F1', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  test.setTimeout(90_000)
  const note = (what: string, v: unknown) => (info.annotations.push({type: what, description: JSON.stringify(v)}), console.log(`[D10] ${what}: ${JSON.stringify(v)}`))
  await installProbes(page.context())
  const P = 'A note opens in the canvas; its title and label are field blocks.'
  before = (await t.docValue(ID, 'blocks', 'note')) as Block[]
  await page.goto(t.docPath('note', ID))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')
  await canvas.getByText(P).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' æøå ÆØÅ ')
  await compose(page, ['´'], 'é')
  await compose(page, ['¨'], 'ö')
  await page.keyboard.type(' ')
  await compose(page, ['n', 'に', 'にh', 'にほ', 'にほん'], '日本')
  const want = `${P} æøå ÆØÅ éö 日本`
  await expect(canvas.getByText(want)).toBeVisible()
  await expect.poll(async () => ((await t.docValue(ID, 'blocks', 'note')) as Block[]).find((b) => b.id === 'n01p')?.content?.map((c) => c.value).join(''), {timeout: 10_000}).toBe(want)
  await page.screenshot({path: 'evidence/D10-1-letters-studio.png'})

  // A 500-block note: type at its end.
  const blocks = Array.from({length: 500}, (_, i) => ({id: `b${i}`, type: i % 25 === 0 ? 'heading' : 'paragraph', ...(i % 25 === 0 ? {level: 2} : {}), content: [{type: 'text', value: `Block ${i}: a paragraph of ordinary length, so the run is as heavy as a long paper.`}]}))
  await mutate([{createOrReplace: {_id: BIG, _type: 'note', title: 'D10 big note', label: 'Idea', body: {blocks}}}, {publish: {id: BIG, type: 'note'}}])
  await page.goto(t.docPath('note', BIG))
  await t.settle(page)
  const last = page.locator('bp-paper-canvas').getByText('Block 499:', {exact: false})
  await last.scrollIntoViewIfNeeded({timeout: 20_000})
  const typed = await typeAndMeasure(page, last, ' Typing at the end of 500 blocks.')
  note('F1 keystroke → paint at the end of a 500-block doc (ms)', stats(typed.keys))
  note('Event Timing keydown entries ≥ 16 ms', stats(typed.slowKeys))
  await page.screenshot({path: 'evidence/D10-2-big-studio.png'})
  expect(stats(typed.keys).p95, 'F1 p95 under 16 ms').toBeLessThan(16)
  await expect.poll(async () => JSON.stringify(((await t.docValue(BIG, 'blocks', 'note')) as Block[]).find((b) => b.id === 'b499')), {timeout: 15_000}).toContain('500 blocks.')
})
