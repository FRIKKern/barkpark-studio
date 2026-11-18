import {expect, test} from '../rig/test'
import {held, keptTitle, scheduleIt, unchanged, unschedule} from '../rig/kept'
import {closeAndSettle, target} from '../rig/targets'

// Kept edits wait while a view is locked (app/src/lib/doc-lock.ts). Before (b47b386f,
// task-9acf2e5f41f8b82d, task-a1c12e23b1ba49e5) field edits kept from a closed tab replayed,
// with no click, into a scheduled draft (here) and into the draft from a revision URL
// (locked-kept-revision.spec). Kept edits are offered again once the doc is editable. Drafts are
// compared by content, read from Barkpark under the doc's own type. A scheduled note's kept
// words: locked-kept-note.spec, locked-kept-note-undo.spec (one test a file, for CI's shards).
const DOC = `fieldTypes-kept-${Date.now().toString(36)}`
let schedule: string | undefined

test.beforeEach(({}, info) => test.skip(target(info).name !== 'studio', 'ours: the lock and the kept edits are ours'))
test.afterEach(async ({page, context}, info) => {
  await closeAndSettle(page)
  for (const p of context.pages()) await p.close()
  await unschedule(schedule)
  schedule = undefined
  await target(info).deleteDoc(DOC, 'fieldTypes')
})

test('kept field edits wait in a scheduled draft; Pause to edit puts them in', async ({page, context}, info) => {
  const t = target(info)
  await keptTitle(context, t, DOC)
  schedule = await scheduleIt('fieldTypes', DOC)
  const before = await held('fieldTypes', DOC)
  await page.goto(t.docPath('fieldTypes', DOC))
  await t.settle(page)
  await expect(page.locator('.chip[data-tone=scheduled]')).toBeVisible()
  expect.soft(await unchanged(page, 'fieldTypes', DOC, before), 'the kept edit was replayed into the scheduled draft').toBe(before)
  await page.locator('.pane-banner[data-tone=scheduled]').getByRole('button', {name: 'Pause to edit'}).click()
  await expect.poll(() => t.docValue(DOC, 'title', 'fieldTypes')).toBe('Kept draft kept')
})
