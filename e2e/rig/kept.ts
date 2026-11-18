import {expect, test, type BrowserContext, type Page} from './test'
import {bpBase, bpDataset, bpMutate, type Target} from './targets'

// What the kept-edits and locked-kept-*.spec files share (the latter split one test a file for
// CI's shards, task-c1df532bed870536): Barkpark reads, a schedule, kept edits in the browser store.
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})

/** The draft (or, with none, the published version) as Barkpark has it: its fields, not its stamps. */
export async function held(type: string, id: string) {
  const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/${type}/${encodeURIComponent(id)}?perspective=drafts`, {headers: auth()})
  const {result} = (await r.json()) as {result?: Record<string, unknown>}
  return JSON.stringify(Object.fromEntries(Object.entries(result ?? {}).filter(([k]) => !k.startsWith('_') || k === '_draft')))
}

/** Writes come late: watched a moment, not read once. */
export async function unchanged(page: Page, type: string, id: string, before: string) {
  for (const until = Date.now() + 700; Date.now() < until && (await held(type, id)) === before; ) await page.waitForTimeout(150)
  return held(type, id)
}

/** Schedules the doc's publish three days out; its schedule id, for unschedule. */
export async function scheduleIt(type: string, id: string) {
  const r = await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}`, {method: 'POST', headers: {...auth(), 'content-type': 'application/json'}, body: JSON.stringify({id, type, publishAt: new Date(Date.now() + 3 * 86_400_000).toISOString()})})
  test.skip(r.status === 404, 'this Barkpark has no scheduled publishes yet (#22775)')
  return ((await r.json()) as {schedule?: {id: string}}).schedule?.id
}
export async function unschedule(schedule: string | undefined) {
  if (schedule) await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}/${encodeURIComponent(schedule)}`, {method: 'DELETE', headers: auth()})
}

export const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})

/** A React state set with a DOM change is drawn by the next frame. */
export const drawn = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))

// This browser's store keeps `value` for `field` of `id` (app/src/lib/pending-edits.ts), written
// KEEP_GAP_MS (150 ms) after the last change (lib/edits.ts keepUnsaved). Opened as the app opens it.
export const stored = (page: Page, id: string, field: string, value: string) =>
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

/** A title typed while saves fail, then the tab dies (kept-edits.spec's crash): the edit is kept in the browser. */
export async function keptTitle(context: BrowserContext, t: Target, id: string) {
  const seed = [{create: {_id: id, _type: 'fieldTypes', title: 'Kept'}}, {publish: {id, type: 'fieldTypes'}}, {patch: {id, type: 'fieldTypes', set: {title: 'Kept draft'}}}]
  await Promise.all([bpMutate(seed), t.prepare(context)])
  const page = await context.newPage()
  await page.addInitScript(() => (navigator.sendBeacon = () => true))
  await page.goto(t.docPath('fieldTypes', id))
  await t.settle(page)
  await page.route('**/_serverFn/**', (route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? route.abort('failed') : route.continue()))
  await t.field(page, 'title').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' kept')
  await expect(page.locator('.doc-footer').first()).toContainText(/Not saved|Offline|not saving/i)
  await stored(page, id, 'title', await t.field(page, 'title').inputValue())
  await page.close({runBeforeUnload: false})
}
