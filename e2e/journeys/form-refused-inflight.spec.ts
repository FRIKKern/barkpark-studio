import {expect, test} from '../rig/test'
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
  // The page's clock, run on by the test past the save loop's 2 s retry (lib/edits.ts) instead of
  // waited out; otherwise it keeps real time.
  await page.clock.install()
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const excerpt = t.field(page, 'excerpt')
  const card = page.getByTestId('field-clash')
  const footer = page.locator('.doc-footer').first()
  const theirs = 'Rewritten while ours was in flight.'
  // Every save is refused. The retry carries all the typing (nothing left unsent): that one
  // is held while the rewrite lands and its live frame reaches this page, then refused.
  let saves = 0
  let held: Promise<void> | undefined
  await page.route('**/_serverFn/**', async (route) => {
    const req = route.request()
    if (!(req.postData() ?? '').includes('mutations')) return route.continue()
    if (++saves === 2)
      await (held = (async () => {
        await bpMutate([{patch: {id: ID, type: 'post', set: {excerpt: theirs}}}])
        await new Promise((r) => setTimeout(r, 600))
      })())
    const res = await route.fetch({postData: (req.postData() ?? '').replace('{"t":1,"s":"post"}', '{"t":1,"s":"no-such-type"}')})
    await route.fulfill({response: res, body: (await res.text()).replace('mutate 404', 'mutate 500').replace('not_found', 'internal')})
  })
  // Inside a word theirs replaces: mine cannot be placed in theirs (a merge would be a guess).
  await excerpt.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.type('mine ')
  await expect(footer).toContainText(/Not saved/i, {timeout: 15_000})
  await page.clock.runFor(2100) // the refused save's retry, due 2 s after it
  await expect.poll(() => saves, {intervals: [50], timeout: 10_000}).toBeGreaterThanOrEqual(2)
  await held
  await expect(card).toBeVisible({timeout: 10_000})
  await expect(card.locator('[data-version="theirs"]')).toHaveText(theirs)
  // Saves flow again: theirs stands until the editor chooses.
  await page.unrouteAll({behavior: 'wait'})
  // Past the 2 s retry a failed save waits, on the page's clock; a write that sends has left
  // 200 ms later, and its answer is in before Barkpark is read.
  const sent: Promise<unknown>[] = []
  page.on('request', (r) => r.method() === 'POST' && (r.postData() ?? '').includes('mutations') && sent.push(r.response()))
  await page.clock.runFor(2200)
  await page.waitForTimeout(200)
  await Promise.all(sent)
  expect((await bpDoc(ID))?.excerpt, 'never saved over theirs unseen').toBe(theirs)
  await card.getByRole('button', {name: 'Take theirs'}).click()
  await expect(excerpt).toHaveValue(theirs)
})
