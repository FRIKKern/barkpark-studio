import {expect, test} from '../rig/test'
import {drawn, para, scheduleIt, unschedule} from '../rig/kept'
import {bpMutate, closeAndSettle, target} from '../rig/targets'

// Another writer's edit offers no Undo while a note is locked (app/src/lib/doc-lock.ts): split
// from locked-kept-write-nothing.spec for CI's shards (task-c1df532bed870536). Before (b47b386f,
// task-a1c12e23b1ba49e5) a scheduled note's read-only canvas offered "Edited by … Undo", and it
// wrote the locked draft.
const NOTE = `note-kept-undo-${Date.now().toString(36)}`
let schedule: string | undefined

test.beforeEach(({}, info) => test.skip(target(info).name !== 'studio', 'ours: the lock and the kept words are ours'))
test.afterEach(async ({page, context}, info) => {
  await closeAndSettle(page)
  for (const p of context.pages()) await p.close()
  await unschedule(schedule)
  schedule = undefined
  await target(info).deleteDoc(NOTE, 'note')
})

test("a scheduled note offers no Undo of another writer's edit", async ({page, context}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(NOTE, 'note', {title: 'Kept note', label: 'L', body: {blocks: [para('n1', 'Note words here.')]}}), t.prepare(context)])
  schedule = await scheduleIt('note', NOTE)
  await page.goto(t.docPath('note', NOTE))
  await t.settle(page)
  const canvas = page.locator('.pd-editor bp-paper-canvas').first()
  await expect(canvas.getByText(/Note words here/)).toBeVisible()
  // Locked before their edit lands (the schedule is read on the client: DocumentPane).
  await expect(canvas).toHaveAttribute('editable', 'false')
  const blocks = [{fieldName: 'title', id: 'synth-f-title-0', type: 'field-string', value: 'Kept note'}, {fieldName: 'label', id: 'synth-f-label-1', type: 'field-string', value: 'L'}, para('n1', 'Changed by another writer.')]
  await bpMutate([{patch: {id: NOTE, type: 'note', set: {blocks, body: {blocks: [para('n1', 'Changed by another writer.')]}}}}])
  await expect(canvas.getByText(/Changed by another writer/)).toBeVisible()
  // The row is set in the same task that puts their words in the canvas (components/
  // PortableDocEditor.tsx: setOtherEdit, then applyServerBlocksIfIdle; who wrote it is only
  // its label, looked up after): it would be drawn by the next frame.
  await drawn(page)
  expect.soft(await page.locator('[data-other-edit]').count(), "Undo of another writer's edit is offered on the read-only canvas").toBe(0)
})
