import {expect, test, type Request} from '../rig/test'
import {bpMutate, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// The form's twin of collab.spec's D11 (#373), its in-flight race: split from
// form-refused.spec for CI's shards (task-c1df532bed870536). A draft-only scratch post.
const ID = 'post-refused'
const SEED = {title: 'Refused post', excerpt: 'Short excerpt here.', tags: ['one'], seo: {metaTitle: 'Meta here', metaDescription: 'A description.'}}
test.setTimeout(60_000)
// The doc is written while the test's browser starts; the test waits for it before opening it.
let seeded: Promise<void>
test.beforeEach(({}, info) => {
  seeded = target(info).draftOnly(ID, 'post', SEED)
  seeded.catch(() => {}) // the test that awaits it says so
})
test.afterEach(async ({page}, info) => (await page.unrouteAll({behavior: 'ignoreErrors'}), await closeAndSettle(page), await target(info).deleteDoc(ID, 'post')))

async function bpDoc(id: string): Promise<Record<string, unknown> | null> {
  const base = `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
  const r = await fetch(`${base}/v1/data/doc/${process.env.BARKPARK_DATASET}/post/${id}?perspective=drafts`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  return r.ok ? ((await r.json()) as {result: Record<string, unknown>}).result : null
}

// The race behind the clash flake (task-41ba9f3dc3fd81e2): someone rewrites the field while
// our write of it is in flight, and that write comes back refused. Before: the rewrite was
// skipped (the field was inflight) but the doc's rev moved on, so the retry saved ours over
// theirs, unseen. Now the refused write's values meet the rewrite at once: the clash card.
test('a rewrite that lands while a refused write is in flight clashes, never saved over', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: our save loop')
  await Promise.all([seeded, t.prepare(page.context())])
  await page.clock.install() // the retry clocks are passed on the page's clock, not sat out
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const excerpt = t.field(page, 'excerpt')
  const card = page.getByTestId('field-clash')
  const footer = page.locator('.doc-footer').first()
  const theirs = 'Rewritten while ours was in flight.'
  // Every save is refused. The first carries all the typing (one insert: nothing left
  // unsent, the field is in flight only). It is held while the rewrite lands and its live
  // frame reaches this page (the page has the frame, not a fixed time), then refused.
  let saves = 0
  let held: Promise<void> | undefined
  await page.route('**/_serverFn/**', async (route) => {
    const req = route.request()
    if (!(req.postData() ?? '').includes('mutations')) return route.continue()
    if (++saves === 1)
      await (held = (async () => {
        await page.evaluate(() => ((window as {__liveFrames?: string[]}).__liveFrames = []))
        await bpMutate([{patch: {id: ID, type: 'post', set: {excerpt: theirs}}}])
        await page.waitForFunction((id) => ((window as {__liveFrames?: string[]}).__liveFrames ?? []).some((f) => f.endsWith(id)), ID, {timeout: 10_000})
      })())
    const res = await route.fetch({postData: (req.postData() ?? '').replace('{"t":1,"s":"post"}', '{"t":1,"s":"no-such-type"}')})
    await route.fulfill({response: res, body: (await res.text()).replace('mutate 404', 'mutate 500').replace('not_found', 'internal')})
  })
  // Inside a word theirs replaces: mine cannot be placed in theirs (a merge would be a guess).
  await excerpt.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.insertText('mine ')
  await expect(footer).toContainText(/Not saved/i, {timeout: 15_000})
  await expect.poll(() => saves, {intervals: [50], timeout: 10_000}).toBeGreaterThanOrEqual(1)
  await held
  await expect(card).toBeVisible({timeout: 10_000})
  await expect(card.locator('[data-version="theirs"]')).toHaveText(theirs)
  // Saves flow again: theirs stands until the editor chooses.
  await page.unrouteAll({behavior: 'wait'})
  // A write that goes from here (none should: a clash waits for the editor) is waited out.
  const writing = new Set<Request>()
  const isWrite = (r: Request) => r.url().includes('/_serverFn/') && (r.postData() ?? '').includes('mutations')
  page.on('request', (r) => void (isWrite(r) && writing.add(r)))
  const done = (r: Request) => void writing.delete(r)
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  // The studio's retry clocks after a failed write, 2 s (lib/edits.ts:679, :862, :933) and 5 s offline
  // (OFFLINE_RETRY_MS, :251), are set as the page reads the refusal: before the card it drew
  // above. Run past both on the page's clock, then 300 ms for real: a retry's send leaves at once
  // (its mutate, :725), and 300 ms is what the real wait (to the refusal + 2.3 s) left past
  // the 2 s. Past that, and past any write that went (none should), theirs still stands.
  await page.clock.fastForward(5_100)
  await page.waitForTimeout(300)
  await expect.poll(() => writing.size, {intervals: [50], timeout: 10_000}).toBe(0)
  expect((await bpDoc(ID))?.excerpt, 'never saved over theirs unseen').toBe(theirs)
  await card.getByRole('button', {name: 'Take theirs'}).click()
  await expect(excerpt).toHaveValue(theirs)
})
