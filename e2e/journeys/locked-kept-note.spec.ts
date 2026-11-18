import {expect, test, type Page} from '../rig/test'
import {bpBase, bpDataset, bpMutate, closeAndSettle, target} from '../rig/targets'

// Kept words wait while a note is locked (app/src/lib/doc-lock.ts): split from
// locked-kept-write-nothing.spec for CI's shards (task-c1df532bed870536). Before (b47b386f,
// task-9acf2e5f41f8b82d, task-a1c12e23b1ba49e5) a scheduled note's read-only canvas offered
// "Put the words back" and "Edited by … Undo", and both wrote the locked draft. Kept words are
// offered again once the doc is editable.
const NOTE = `note-kept-${Date.now().toString(36)}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})
let schedule: string | undefined

async function scheduleIt(type: string, id: string) {
  const r = await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}`, {method: 'POST', headers: {...auth(), 'content-type': 'application/json'}, body: JSON.stringify({id, type, publishAt: new Date(Date.now() + 3 * 86_400_000).toISOString()})})
  test.skip(r.status === 404, 'this Barkpark has no scheduled publishes yet (#22775)')
  schedule = ((await r.json()) as {schedule?: {id: string}}).schedule?.id
}
// A React state set with a DOM change is drawn by the next frame.
const drawn = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))

test.beforeEach(({}, info) => test.skip(target(info).name !== 'studio', 'ours: the lock and the kept words are ours'))
test.afterEach(async ({page, context}, info) => {
  await closeAndSettle(page)
  for (const p of context.pages()) await p.close()
  if (schedule) await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}/${encodeURIComponent(schedule)}`, {method: 'DELETE', headers: auth()})
  schedule = undefined
  await target(info).deleteDoc(NOTE, 'note')
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
  // The canvas reads the kept words as it is put on the page, in the same task that sets its
  // editable attribute (components/PortableDocEditor.tsx: setAttribute('editable'), then
  // readKept and setOffer); an offer would be drawn by the next frame.
  await drawn(page)
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
  // The row is set in the same task that puts their words in the canvas (components/
  // PortableDocEditor.tsx: setOtherEdit, then applyServerBlocksIfIdle; who wrote it is only
  // its label, looked up after): it would be drawn by the next frame.
  await drawn(page)
  expect.soft(await page.locator('[data-other-edit]').count(), "Undo of another writer's edit is offered on the read-only canvas").toBe(0)
})
