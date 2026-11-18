import {expect, test, type BrowserContext, type Page} from '../rig/test'
import {bpBase, bpDataset, bpMutate, closeAndSettle, target, type Target} from '../rig/targets'

// Kept edits wait while a view is locked (app/src/lib/doc-lock.ts). Before (b47b386f,
// task-9acf2e5f41f8b82d, task-a1c12e23b1ba49e5) field edits kept from a closed tab replayed,
// with no click, into a scheduled draft and into the draft from a revision URL. Kept edits are
// offered again once the doc is editable. Drafts are compared by content, read from Barkpark
// under the doc's own type. A scheduled note's kept words: locked-kept-note.spec.
const DOC = `fieldTypes-kept-${Date.now().toString(36)}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
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
// This browser's store keeps `value` for `field` of `id` (app/src/lib/pending-edits.ts), written
// KEEP_GAP_MS (150 ms) after the last change (lib/edits.ts keepUnsaved). Opened as the app opens it.
const stored = (page: Page, id: string, field: string, value: string) =>
  expect.poll(() => page.evaluate(([id, field, value]) => new Promise<boolean>((done) => {
    const req = indexedDB.open('bp-pending-edits', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('docs')
    req.onerror = () => done(false)
    req.onsuccess = () => {
      const db = req.result
      const end = (found: boolean) => (db.close(), done(found))
      const cursor = db.transaction('docs').objectStore('docs').openCursor()
      cursor.onerror = () => end(false)
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) return end(false)
        const p = c.value as {fields?: [string, unknown][]}
        if (String(c.key).includes(`|${id}|`) && p.fields?.some(([f, v]) => f === field && v === value)) return end(true)
        c.continue()
      }
    }
  }), [id, field, value] as const), {intervals: [50], message: 'kept in the browser store'}).toBe(true)

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
  await stored(page, DOC, 'title', await t.field(page, 'title').inputValue())
  await page.close({runBeforeUnload: false})
}

test.beforeEach(({}, info) => test.skip(target(info).name !== 'studio', 'ours: the lock and the kept edits are ours'))
test.afterEach(async ({page, context}, info) => {
  await closeAndSettle(page)
  for (const p of context.pages()) await p.close()
  if (schedule) await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}/${encodeURIComponent(schedule)}`, {method: 'DELETE', headers: auth()})
  schedule = undefined
  await target(info).deleteDoc(DOC, 'fieldTypes')
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
