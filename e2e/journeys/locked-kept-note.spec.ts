import {expect, test} from '../rig/test'
import {drawn, para, scheduleIt, unschedule} from '../rig/kept'
import {closeAndSettle, target} from '../rig/targets'

// Kept words wait while a note is locked (app/src/lib/doc-lock.ts): split from
// locked-kept-write-nothing.spec for CI's shards (task-c1df532bed870536). Before (b47b386f,
// task-9acf2e5f41f8b82d, task-a1c12e23b1ba49e5) a scheduled note's read-only canvas offered
// "Put the words back" (here) and "Edited by … Undo" (locked-kept-note-undo.spec), and both
// wrote the locked draft. Kept words are offered again once the doc is editable.
const NOTE = `note-kept-${Date.now().toString(36)}`
let schedule: string | undefined

test.beforeEach(({}, info) => test.skip(target(info).name !== 'studio', 'ours: the lock and the kept words are ours'))
test.afterEach(async ({page, context}, info) => {
  await closeAndSettle(page)
  for (const p of context.pages()) await p.close()
  await unschedule(schedule)
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
  schedule = await scheduleIt('note', NOTE)
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
