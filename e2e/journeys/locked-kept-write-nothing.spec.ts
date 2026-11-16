import {expect, test, type BrowserContext, type Page} from '../rig/test'
import {bpBase, bpDataset, bpMutate, closeAndSettle, target, type Target} from '../rig/targets'

// Kept words and kept edits wait while a view is locked (app/src/lib/doc-lock.ts). Before
// (b47b386f, task-9acf2e5f41f8b82d, task-a1c12e23b1ba49e5):
// - field edits kept from a closed tab replayed, with no click, into a scheduled draft and
//   into the draft from a revision URL;
// - a scheduled note's read-only canvas offered "Put the words back" and "Edited by … Undo",
//   and both wrote the locked draft.
// Kept edits are offered again once the doc is editable. Drafts are compared by content, read
// from Barkpark under the doc's own type.
const stamp = Date.now().toString(36)
const DOC = `fieldTypes-kept-${stamp}`
const NOTE = `note-kept-${stamp}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})
let schedule: string | undefined

async function held(type: string, id: string) {
  const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/${type}/${encodeURIComponent(id)}?perspective=drafts`, {headers: auth()})
  const {result} = (await r.json()) as {result?: Record<string, unknown>}
  return JSON.stringify(Object.fromEntries(Object.entries(result ?? {}).filter(([k]) => !k.startsWith('_') || k === '_draft')))
}
async function unchanged(page: Page, type: string, id: string, before: string) {
  for (const until = Date.now() + 700; Date.now() < until && (await held(type, id)) === before; ) await page.waitForTimeout(150)
  return held(type, id)
}
async function scheduleIt(type: string, id: string) {
  const r = await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}`, {method: 'POST', headers: {...auth(), 'content-type': 'application/json'}, body: JSON.stringify({id, type, publishAt: new Date(Date.now() + 3 * 86_400_000).toISOString()})})
  test.skip(r.status === 404, 'this Barkpark has no scheduled publishes yet (#22775)')
  schedule = ((await r.json()) as {schedule?: {id: string}}).schedule?.id
}
// A title typed while saves fail, then the tab dies (kept-edits.spec's crash).
async function keptTitle(context: BrowserContext, t: Target) {
  const seed = [{create: {_id: DOC, _type: 'fieldTypes', title: 'Kept'}}, {publish: {id: DOC, type: 'fieldTypes'}}, {patch: {id: DOC, type: 'fieldTypes', set: {title: 'Kept draft'}}}]
  await Promise.all([bpMutate(seed), t.prepare(context)])
  const page = await context.newPage()
  await page.addInitScript(() => (navigator.sendBeacon = () => true))
  await page.goto(t.docPath('fieldTypes', DOC))
  await t.settle(page)
  await page.route('**/_serverFn/**', (route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? route.abort('failed') : route.continue()))
  await t.field(page, 'title').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' kept')
  await expect(page.locator('.doc-footer').first()).toContainText(/Not saved|Offline|not saving/i)
  await page.waitForTimeout(500) // the browser store is written a moment after the last keystroke
  await page.close({runBeforeUnload: false})
}

test.beforeEach(({}, info) => test.skip(target(info).name !== 'studio', 'ours: the lock and the kept edits are ours'))
test.afterEach(async ({page, context}, info) => {
  await closeAndSettle(page)
  for (const p of context.pages()) await p.close()
  if (schedule) await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}/${encodeURIComponent(schedule)}`, {method: 'DELETE', headers: auth()})
  schedule = undefined
  await Promise.all([target(info).deleteDoc(DOC, 'fieldTypes'), target(info).deleteDoc(NOTE, 'note')])
})

test('kept field edits wait in a scheduled draft; Pause to edit puts them in', async ({page, context}, info) => {
  const t = target(info)
  await keptTitle(context, t)
  await scheduleIt('fieldTypes', DOC)
  const before = await held('fieldTypes', DOC)
  await page.goto(t.docPath('fieldTypes', DOC))
  await t.settle(page)
  await expect(page.locator('.chip[data-tone=scheduled]')).toBeVisible()
  expect.soft(await unchanged(page, 'fieldTypes', DOC, before), 'the kept edit was replayed into the scheduled draft').toBe(before)
  await page.locator('.pane-banner[data-tone=scheduled]').getByRole('button', {name: 'Pause to edit'}).click()
  await expect.poll(() => t.docValue(DOC, 'title', 'fieldTypes')).toBe('Kept draft kept')
})

test('kept field edits wait at a revision URL', async ({page, context}, info) => {
  const t = target(info)
  await keptTitle(context, t)
  await expect.poll(() => t.historyReady(DOC)).toBe(true)
  const r = await fetch(`${bpBase()}/v1/data/history/${bpDataset()}/fieldTypes/${encodeURIComponent(DOC)}?limit=10`, {headers: auth()})
  const rev = ((await r.json()) as {revisions: {id: string; status: string}[]}).revisions.find((v) => v.status === 'published')!.id
  const before = await held('fieldTypes', DOC)
  await page.goto(`${t.docPath('fieldTypes', DOC)},rev=${rev}`)
  await t.settle(page)
  expect.soft(await unchanged(page, 'fieldTypes', DOC, before), 'the kept edit was replayed from a revision URL').toBe(before)
})

test('a scheduled note offers no Put the words back; Pause to edit offers it', async ({page, context}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(NOTE, 'note', {title: 'Kept note', label: 'L', body: {blocks: [para('n1', 'Note words here.')]}}), t.prepare(context)])
  const first = await context.newPage()
  await first.goto(t.docPath('note', NOTE))
  await t.settle(first)
  await first.route('**/_serverFn/**', (route) => ((route.request().postData() ?? '').includes('"ifRev"') ? route.abort('internetdisconnected') : route.continue()))
  await first.locator('bp-paper-canvas').getByText(/Note words here/).click()
  await first.keyboard.press('End')
  await first.keyboard.type(' kept')
  await expect(first.locator('.pd-status')).toContainText('Your edits are kept here.')
  await first.close()
  await scheduleIt('note', NOTE)
  await page.goto(t.docPath('note', NOTE))
  await t.settle(page)
  await expect(page.locator('.pd-editor bp-paper-canvas').first()).toHaveAttribute('editable', 'false')
  await page.waitForTimeout(700) // an offer is drawn once the canvas has read the kept words
  expect.soft(await page.locator('[data-kept-words]').count(), 'Put the words back is offered on the read-only canvas').toBe(0)
  await page.locator('.pane-banner[data-tone=scheduled]').getByRole('button', {name: 'Pause to edit'}).click()
  await expect(page.locator('[data-kept-words]')).toContainText('Words were not saved:')
})

test("a scheduled note offers no Undo of another writer's edit", async ({page, context}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(NOTE, 'note', {title: 'Kept note', label: 'L', body: {blocks: [para('n1', 'Note words here.')]}}), t.prepare(context)])
  await scheduleIt('note', NOTE)
  await page.goto(t.docPath('note', NOTE))
  await t.settle(page)
  const canvas = page.locator('.pd-editor bp-paper-canvas').first()
  await expect(canvas.getByText(/Note words here/)).toBeVisible()
  const blocks = [{fieldName: 'title', id: 'synth-f-title-0', type: 'field-string', value: 'Kept note'}, {fieldName: 'label', id: 'synth-f-label-1', type: 'field-string', value: 'L'}, para('n1', 'Changed by another writer.')]
  await bpMutate([{patch: {id: NOTE, type: 'note', set: {blocks, body: {blocks: [para('n1', 'Changed by another writer.')]}}}}])
  await expect(canvas.getByText(/Changed by another writer/)).toBeVisible()
  await page.waitForTimeout(700) // the row is drawn once the canvas has looked up who wrote it
  expect.soft(await page.locator('[data-other-edit]').count(), "Undo of another writer's edit is offered on the read-only canvas").toBe(0)
})
