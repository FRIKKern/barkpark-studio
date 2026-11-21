import {expect, test, type BrowserContext, type Page, type Request} from './test'
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

// The longest a field edit's save waits before it goes (lib/edits.ts:502 schedule: the pace after
// throttled writes, lib/write-pace.ts:10 MAX_MS, 4 s; a fresh page's write budget has its burst).
const SAVE_DELAY_MS = 4_100

/**
 * Barkpark's draft once nothing can still be on its way, `before` when nothing was written.
 * Writes come late, so this is not one read: the page's clock (page.clock.install() before its
 * goto) is run past SAVE_DELAY_MS, which fires any timer the page set for a save in that time and
 * sends what it queued, with no real second spent. Then the kept-edits store and the tab locks
 * (lib/pending-edits.ts) answer what a replay asked them, and nothing may have been sent or be
 * pending. A write sent or pending comes back named after the draft, so it is never `before`.
 * The 700 ms watched before missed a save set later than that (task-96f9e226705a9122).
 */
export async function unchanged(page: Page, type: string, id: string, before: string) {
  let sent = 0
  const count = (r: Request) => void (r.method() === 'POST' && r.url().includes('/_serverFn/') && (r.postData() ?? '').includes('mutations') && sent++)
  page.on('request', count)
  try {
    await page.clock.fastForward(SAVE_DELAY_MS)
    const pending = await page.evaluate(async () => {
      // A read-write transaction starts only after the ones made before it on the store end.
      await new Promise<void>((done) => {
        const req = indexedDB.open('bp-pending-edits', 1)
        req.onupgradeneeded = () => req.transaction?.abort() // no store: no replay read one either
        req.onerror = req.onblocked = () => done()
        req.onsuccess = () => {
          const tx = req.result.transaction('docs', 'readwrite')
          tx.oncomplete = tx.onabort = tx.onerror = () => (req.result.close(), done())
        }
      })
      await navigator.locks?.query()
      return (window as unknown as {__savesPending: () => boolean}).__savesPending()
    })
    if (pending) await page.waitForFunction(() => !(window as unknown as {__savesPending: () => boolean}).__savesPending(), null, {timeout: 10_000}).catch(() => {})
    const now = await held(type, id)
    return sent || pending ? `${now} (${sent} write(s) sent, ${pending ? 'one pending' : 'none pending'})` : now
  } finally {
    page.off('request', count)
  }
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
