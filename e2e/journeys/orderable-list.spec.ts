import {expect, test, type Page} from '../rig/test'
import {BACKEND_POLL, bpBase, bpDataset, target} from '../rig/targets'

// Manual order (Sanity's @sanity/orderable-document-list): under "Sort by Manual order" a
// category drags to a new place, and that place is one rank on that one document, kept
// across a reload and read back from Barkpark in the same order (`order=orderRank:asc`).
// The fixture's categories carry no rank; afterwards they carry none again.
const IDS = ['category-news', 'category-guide', 'category-opinion']
const headers = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`, 'content-type': 'application/json'})
/** Barkpark's exact-id mutate: the published document itself (the route the studio moves a rank by). */
const exact = (mutations: unknown[]) => fetch(`${bpBase()}/v2025-02-19/data/mutate/${bpDataset()}`, {method: 'POST', headers: headers(), body: JSON.stringify({mutations})})
const served = async () => {
  const res = await fetch(`${bpBase()}/v1/data/query/${bpDataset()}/category?order=orderRank:asc&perspective=published&limit=10`, {headers: headers()})
  return ((await res.json()) as {result: {documents: {_id: string; title: string; orderRank?: string}[]}}).result.documents
}
const titles = (page: Page) => page.locator('[data-pane="list:category"] [role=listitem] .t').allTextContents()

test.beforeEach(({}, info) => test.skip(target(info).name !== 'studio', 'ours: the reference studio does not install the plugin'))

test('@local manual order: drag row three above row one, the order holds across a reload', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  // A known order to start from: News, Guide, Opinion, ranked as Sanity's plugin ranks them.
  expect((await exact(IDS.map((id, i) => ({patch: {id, set: {orderRank: ['0|hzzzzz:', '0|i00007:', '0|i0000f:'][i]}}})))).status).toBe(200)
  try {
    await page.goto(t.listPath('category'))
    await t.settle(page)
    const list = t.pane(page, 1)
    // Any other sort: no handles.
    await expect(list.getByRole('listitem')).toHaveCount(3)
    await expect(list.locator('.order-handle')).toHaveCount(0)
    await t.listMenu(list).click()
    await page.getByText('Sort by Manual order').click()
    await expect(list.locator('.order-handle')).toHaveCount(3)
    await expect.poll(() => titles(page), {intervals: [50]}).toEqual(['News', 'Guide', 'Opinion'])

    // Drag Opinion (row three) above News (row one).
    const from = (await list.locator('.order-handle').nth(2).boundingBox())!
    const to = (await list.getByRole('listitem').nth(0).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, to.y + 4, {steps: 4})
    await page.mouse.up()
    await expect.poll(() => titles(page), {intervals: [50]}).toEqual(['Opinion', 'News', 'Guide'])

    // One document changed, to a rank before the first; the other two keep theirs. No draft was made.
    await expect.poll(async () => (await served()).map((d) => d.title), BACKEND_POLL).toEqual(['Opinion', 'News', 'Guide'])
    const docs = await served()
    expect(docs.slice(1).map((d) => d.orderRank)).toEqual(['0|hzzzzz:', '0|i00007:'])
    expect(docs[0]!.orderRank! < '0|hzzzzz:').toBe(true)
    expect(docs.map((d) => d._id)).toEqual(['category-opinion', 'category-news', 'category-guide'])

    await page.reload()
    await t.settle(page)
    await expect.poll(() => titles(page), {intervals: [50]}).toEqual(['Opinion', 'News', 'Guide'])
    // A search is not the manual order: no handles while it filters.
    await page.getByPlaceholder('Search list').fill('o')
    await expect(list.locator('.order-handle')).toHaveCount(0)
  } finally {
    await page.getByPlaceholder('Search list').fill('').catch(() => {})
    await t.listMenu(t.pane(page, 1)).click()
    await page.getByText('Default sort').click()
    expect((await exact(IDS.map((id) => ({patch: {id, unset: ['orderRank']}})))).status).toBe(200)
  }
})
