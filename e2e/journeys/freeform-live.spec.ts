import {readFileSync} from 'node:fs'
import {expect, test, type Page} from '@playwright/test'
import {target} from '../rig/targets'

// D03 (Freeform side track, ours only): two browsers on story-01, A in Freeform and B
// in Classic. A edits the Kicker field block, B's Classic field follows; B edits the
// Summary in Classic, A's canvas follows (taken while A's canvas is idle). Nobody's
// focus moves (F6). How long each took goes to the annotations (F4). Stills in
// e2e/evidence/D03-*.
const ID = 'story-01'
// story-01's bound values live in its block list (field-string / field-text blocks).
const SEED_BLOCKS = (JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${ID}"`))!) as {blocks: {id: string; fieldName?: string; value?: string}[]}).blocks
const bound = (name: string) => SEED_BLOCKS.find((x) => x.fieldName === name)!.value!
const SEED = {kicker: bound('kicker'), summary: bound('summary'), blocks: SEED_BLOCKS}
const shot = (step: string) => `evidence/D03-${step}-studio.png`

test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio') await target(info).restore(ID, {kicker: SEED.kicker, summary: SEED.summary, blocks: SEED.blocks}, 'story')
})

const fieldBlock = (p: Page, label: string) =>
  p.locator('bp-paper-canvas .bp-canvas-field').filter({has: p.locator('.bp-canvas-field-label', {hasText: label})}).locator('input, textarea')

test('@local D03: a bound field edited in Freeform shows in Classic in a 2nd browser, and back', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  const note = (what: string, v: unknown) => (info.annotations.push({type: what, description: JSON.stringify(v)}), console.log(`[D03] ${what}: ${JSON.stringify(v)}`))
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto(`${t.docPath('story', ID)},view=freeform`), b.goto(t.docPath('story', ID))])
    await Promise.all([t.settle(a), t.settle(b)])
    await expect(fieldBlock(a, 'Kicker')).toHaveValue(SEED.kicker, {timeout: 20_000})
    await expect(t.field(b, 'kicker')).toHaveValue(SEED.kicker)

    // A (Freeform) → B (Classic).
    await fieldBlock(a, 'Kicker').fill('Kicker from Freeform')
    let sent = Date.now()
    await expect(t.field(b, 'kicker')).toHaveValue('Kicker from Freeform', {timeout: 10_000})
    note('Freeform edit seen in Classic (ms, incl. the canvas debounce)', Date.now() - sent)
    await Promise.all([a.screenshot({path: shot('1-A-freeform')}), b.screenshot({path: shot('1-B-classic')})])

    // B (Classic) → A (Freeform). A's focus is elsewhere on its page and must stay there.
    await a.getByRole('tab', {name: 'Freeform'}).focus()
    await t.field(b, 'summary').fill('Summary from Classic')
    sent = Date.now()
    await expect(fieldBlock(a, 'Summary')).toHaveValue('Summary from Classic', {timeout: 10_000})
    note('Classic edit seen in Freeform (ms)', Date.now() - sent)
    expect(await a.evaluate(() => document.activeElement?.getAttribute('role')), 'F6: A keeps its focus').toBe('tab')
    // A still shows its own edit, and the block list is whole.
    await expect(fieldBlock(a, 'Kicker')).toHaveValue('Kicker from Freeform')
    await Promise.all([a.screenshot({path: shot('2-A-freeform')}), b.screenshot({path: shot('2-B-classic')})])
    expect((await t.docValue(ID, 'kicker', 'story')) as string).toBe('Kicker from Freeform')
    expect((await t.docValue(ID, 'summary', 'story')) as string).toBe('Summary from Classic')
    const ids = ((await t.docValue(ID, 'blocks', 'story')) as {id: string}[]).map((x) => x.id)
    expect(ids, 'same blocks, same order').toEqual((SEED.blocks as {id: string}[]).map((x) => x.id))
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})
