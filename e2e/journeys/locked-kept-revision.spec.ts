import {expect, test} from '../rig/test'
import {held, keptTitle, unchanged} from '../rig/kept'
import {bpBase, bpDataset, closeAndSettle, target} from '../rig/targets'

// Field edits kept from a closed tab wait at a revision URL (app/src/lib/doc-lock.ts): before
// b47b386f they replayed, with no click, into the draft. Split from locked-kept-write-nothing.spec
// for CI's shards (task-c1df532bed870536).
const DOC = `fieldTypes-kept-rev-${Date.now().toString(36)}`

test.beforeEach(({}, info) => test.skip(target(info).name !== 'studio', 'ours: the lock and the kept edits are ours'))
test.afterEach(async ({page, context}, info) => {
  await closeAndSettle(page)
  for (const p of context.pages()) await p.close()
  await target(info).deleteDoc(DOC, 'fieldTypes')
})

test('kept field edits wait at a revision URL', async ({page, context}, info) => {
  const t = target(info)
  await keptTitle(context, t, DOC)
  await expect.poll(() => t.historyReady(DOC)).toBe(true)
  const r = await fetch(`${bpBase()}/v1/data/history/${bpDataset()}/fieldTypes/${encodeURIComponent(DOC)}?limit=10`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  const rev = ((await r.json()) as {revisions: {id: string; status: string}[]}).revisions.find((v) => v.status === 'published')!.id
  const before = await held('fieldTypes', DOC)
  await page.clock.install() // unchanged() runs it past the page's save delay
  await page.goto(`${t.docPath('fieldTypes', DOC)},rev=${rev}`)
  await t.settle(page)
  expect.soft(await unchanged(page, 'fieldTypes', DOC, before), 'the kept edit was replayed from a revision URL').toBe(before)
})
