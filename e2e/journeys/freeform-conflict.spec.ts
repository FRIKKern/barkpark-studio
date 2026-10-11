import {readFileSync} from 'node:fs'
import {expect, test, type Page} from '@playwright/test'
import {target, closeAndSettle} from '../rig/targets'

// D05 (Freeform side track, ours only): two tabs on note-01 in Freeform. A changes the
// Title block; B changes the Label block on the rev it had, so its save is refused
// (412). Per the canvas's EMBED-CONTRACT, B resends the same batch on the current rev:
// block ops are id-keyed, so both edits land, nothing is lost and no card asks
// anything. B's save is held back on the wire until A's has landed, so the 412 always
// happens. Stills in e2e/evidence/D05-*.
const ID = 'note-01'
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${ID}"`))!) as {
  title: string
  label: string
  body: unknown
}
type Block = {id: string}
let before: Block[] | undefined
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio' && before) await target(info).restore(ID, {title: SEED.title, label: SEED.label, body: SEED.body, blocks: before}, 'note')
})

const fieldBlock = (p: Page, label: string) =>
  p.locator('bp-paper-canvas .bp-canvas-field').filter({has: p.locator('.bp-canvas-field-label', {hasText: label})}).locator('input')
const isOps = (body: string | null) => !!body && body.includes('"ifRev"')

test('@local D05: two tabs, same doc — a 412 resends on the other\'s rev, both edits kept', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  before = (await t.docValue(ID, 'blocks', 'note')) as Block[]
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto(t.docPath('note', ID)), b.goto(t.docPath('note', ID))])
    await Promise.all([t.settle(a), t.settle(b)])
    await Promise.all([expect(fieldBlock(a, 'Title')).toHaveValue(SEED.title, {timeout: 20_000}), expect(fieldBlock(b, 'Label')).toHaveValue(SEED.label, {timeout: 20_000})])

    // B's ops go out only after A's have landed; what B's server answered is recorded.
    let aSaved!: () => void
    const aLanded = new Promise<void>((r) => (aSaved = r))
    a.on('response', async (r) => isOps(r.request().postData()) && (await r.text()).includes('"ok"') && aSaved())
    const bAnswers: number[] = []
    b.on('response', async (r) => {
      if (!isOps(r.request().postData())) return
      // The server function's answer (seroval): {ok:false, status:412, …} or {ok:true, rev}.
      bAnswers.push(/"s":412\b/.test(await r.text()) ? 412 : 200)
    })
    await b.route('**/_serverFn/**', async (route) => {
      if (isOps(route.request().postData())) await aLanded
      await route.continue()
    })

    await fieldBlock(b, 'Label').fill('Label from B')
    await fieldBlock(a, 'Title').fill('Title from A')
    await expect.poll(() => t.docValue(ID, 'title', 'note'), {timeout: 15_000}).toBe('Title from A')
    await expect.poll(() => t.docValue(ID, 'label', 'note'), {timeout: 15_000}).toBe('Label from B')
    expect(bAnswers[0], "B's first save was refused as stale").toBe(412)
    await expect(b.locator('.pd-status')).toHaveText('Saved', {timeout: 10_000})
    await expect(b.locator('.pd-conflict')).toHaveCount(0)
    // Both tabs end with both edits; the block list is whole.
    await expect(fieldBlock(b, 'Title')).toHaveValue('Title from A', {timeout: 10_000})
    await expect(fieldBlock(a, 'Label')).toHaveValue('Label from B', {timeout: 10_000})
    expect(((await t.docValue(ID, 'blocks', 'note')) as Block[]).map((x) => x.id)).toEqual(before.map((x) => x.id))
    info.annotations.push({type: "B's answers", description: JSON.stringify(bAnswers)})
    await Promise.all([a.screenshot({path: 'evidence/D05-A-studio.png'}), b.screenshot({path: 'evidence/D05-B-studio.png'})])
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})

// D20: when the 412 resends run out (here every save is sent on a stale rev), the
// canvas asks, as Barkdown does: "Load the server version" drops the edit and shows
// Barkpark's blocks; "Re-apply my edit on top" saves it on the current rev.
// The ops request's last string is its ifRev (seroval): the rev is swapped for a stale one.
const staleRev = (body: string) => {
  const revs = [...body.matchAll(/\{"t":1,"s":"([0-9a-f]{16,})"\}/g)]
  const last = revs.at(-1)
  return last ? body.slice(0, last.index) + '{"t":1,"s":"0000000000000000000000000000000a"}' + body.slice(last.index! + last[0].length) : body
}

for (const answer of ['theirs', 'mine'] as const) {
  test(`@local D20: retries run out — the conflict card, then ${answer === 'theirs' ? '"Load the server version"' : '"Re-apply my edit on top"'}`, async ({page, context}, info) => {
    const t = target(info)
    test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
    before = (await t.docValue(ID, 'blocks', 'note')) as Block[]
    await t.prepare(context)
    await page.goto(t.docPath('note', ID))
    await t.settle(page)
    const label = fieldBlock(page, 'Label')
    await expect(label).toHaveValue(SEED.label, {timeout: 20_000})

    let stale = true
    await page.route('**/_serverFn/**', (route) => {
      const body = route.request().postData()
      return stale && isOps(body) ? route.continue({postData: staleRev(body!)}) : route.continue()
    })
    await label.fill('Mine')
    const card = page.locator('[data-conflict]')
    await expect(card).toContainText('Someone else changed this document', {timeout: 15_000})
    await expect(card).toContainText('Your unsaved edits are still on screen.')
    await expect(page.locator('.pd-status')).toHaveText('Conflict')
    await page.screenshot({path: `evidence/D20-1-card.png`})
    stale = false

    if (answer === 'theirs') {
      await card.getByRole('button', {name: 'Load the server version'}).click()
      await expect(card).toHaveCount(0)
      await expect(label).toHaveValue(SEED.label)
      await expect(page.locator('.pd-status')).toHaveText('Saved')
      expect(await t.docValue(ID, 'label', 'note')).toBe(SEED.label)
    } else {
      await card.getByRole('button', {name: 'Re-apply my edit on top'}).click()
      await expect(card).toHaveCount(0)
      await expect.poll(() => t.docValue(ID, 'label', 'note'), {timeout: 15_000}).toBe('Mine')
      await expect(page.locator('.pd-status')).toHaveText('Saved', {timeout: 10_000})
      await expect(label).toHaveValue('Mine')
    }
  })
}
