import {expect, test} from '../rig/test'
import {bpBase, bpDataset, bpMutate, bpRemove, closeAndSettle, signInIfAsked, target} from '../rig/targets'

// B03 widen (task-22ce73ad72423b85): ticked rows deleted in one go, and a row other documents
// refer to is named in the confirm with who refers, and left alone. What breaks silently: a
// bulk delete that takes the referenced row too, or deletes nothing and says it did. On
// scratch authors and a scratch post of its own, removed after (fixture authors untouched).
const AUTHORS = ['author-b03-del-a', 'author-b03-del-b', 'author-b03-del-c']
const NAMES = ['B03 delete A', 'B03 delete B', 'B03 delete C']
const POST = 'post-b03-del-ref'
const get = (path: string) => fetch(`${bpBase()}${path}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
const exists = async (id: string) => (await Promise.all(['drafts', 'published'].map((p) => get(`/v1/data/doc/${bpDataset()}/author/${id}?perspective=${p}`)))).some((r) => r.status !== 404)
// The post first (it refers to an author), then the authors at once.
const cleanup = async () => {
  await bpRemove(POST, 'post')
  await Promise.all(AUTHORS.map((id) => bpRemove(id, 'author')))
}
test.afterEach(async ({page}) => {
  await closeAndSettle(page)
  await cleanup()
})

test('B03: delete ticked rows; a row others refer to is named and left alone', async ({page}, info) => {
  test.skip(info.project.name !== 'studio', 'ours: Sanity and the LiveView desk have no bulk delete')
  const t = target(info)
  await cleanup()
  await bpMutate([
    ...AUTHORS.map((id, i) => ({createOrReplace: {_id: id, _type: 'author', name: NAMES[i]}})),
    {createOrReplace: {_id: POST, _type: 'post', title: 'B03 delete referrer', slug: {_type: 'slug', current: 'b03-delete-referrer'}, author: {_type: 'reference', _ref: AUTHORS[1]}}},
    ...AUTHORS.map((id) => ({publish: {id, type: 'author'}})),
    {publish: {id: POST, type: 'post'}},
  ])
  // Barkpark indexes the edge a moment after the write: the confirm reads it from there.
  await expect.poll(async () => ((await (await get(`/v1/data/backlinks/${bpDataset()}/${AUTHORS[1]}`)).json()) as {result: {backlinks: unknown[]}}).result.backlinks.length, {intervals: [100, 250]}).toBe(1)
  await page.goto(t.listPath('author'))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('button', {name: 'List options'}).first().click()
  await page.getByRole('menuitemradio', {name: 'Select documents'}).click()
  for (const name of NAMES) await page.getByRole('checkbox', {name: `Select ${name}`}).check()
  await page.getByRole('region', {name: 'Bulk actions'}).getByRole('button', {name: 'Delete selected'}).click()

  const dialog = page.getByRole('dialog', {name: 'Delete 3 documents?'})
  await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused()
  await expect(dialog.getByRole('region', {name: 'Left alone'})).toContainText('B03 delete B')
  await expect(dialog.locator('.used-in li')).toHaveText(/B03 delete referrer/)
  await dialog.getByRole('button', {name: 'Delete 2 documents'}).click()
  await expect(dialog.getByRole('status')).toHaveText('Deleted 2 of 3. 1 left alone.', {timeout: 10_000})
  await expect(dialog.getByRole('list', {name: 'Results'}).locator('li[data-state="done"]')).toHaveCount(2)
  expect(await Promise.all(AUTHORS.map(exists))).toEqual([false, true, false])
  // Closed: the row left alone stays ticked, the deleted ones left the list.
  await dialog.getByRole('button', {name: 'Close'}).last().click()
  await expect(page.getByRole('region', {name: 'Bulk actions'}).getByRole('status')).toHaveText('1 selected')
  await expect(page.getByRole('checkbox', {name: 'Select B03 delete A'})).toHaveCount(0)
})
