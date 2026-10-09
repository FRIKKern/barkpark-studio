import {expect, test} from '@playwright/test'
import {bpMutate, target} from '../rig/targets'

// B07 (Barkpark-native, ours only), after LiveView's unpublish guard: unpublishing an
// author the posts refer to lists those posts (title, type / field) first; Cancel leaves
// it live, "Unpublish anyway" unpublishes. B03's bulk unpublish shows the same, per doc.
const base = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/data/doc/${process.env.BARKPARK_DATASET}/author`
const live = (id: string) => fetch(`${base()}/${id}?perspective=published`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}}).then((r) => r.ok)
test.afterEach(async ({}, info) => {
  const t = target(info)
  if (t.name === 'studio') await t.restore('author-ada', {name: 'Ada Lovelace'}, 'author')
})

test('@local B07: unpublish lists who refers to it first; Cancel or Unpublish anyway', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: Sanity blocks only delete')
  await page.goto(`${t.docPath('author', 'author-alan')}?perspective=published`)
  await t.settle(page)
  await page.getByRole('button', {name: 'Unpublish', exact: true}).click()
  const dialog = page.getByRole('dialog', {name: 'Unpublish document?'})
  await expect(dialog.getByRole('status')).toHaveText('“Alan Turing” is referenced by 10 documents. Unpublishing it will leave those references pointing at nothing live:')
  await expect(dialog.locator('.used-in li')).toHaveCount(10)
  await expect(dialog.locator('.used-in li').first()).toContainText('Post / author')
  await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused()
  await page.screenshot({path: 'evidence/B07-1-guard-studio.png'})
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await live('author-alan'), 'Cancel leaves it live').toBe(true)

  await page.goto(`${t.docPath('author', 'author-ada')}?perspective=published`)
  await t.settle(page)
  await page.getByRole('button', {name: 'Unpublish', exact: true}).click()
  await page.getByRole('dialog').getByRole('button', {name: 'Unpublish anyway'}).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect.poll(() => live('author-ada')).toBe(false)

  // Bulk: one section per referenced doc.
  await page.goto(t.listPath('author'))
  await t.settle(page)
  // Ticks show once selecting starts (list menu, or a Cmd/Ctrl-click), never on a plain hover.
  await page.getByRole('button', {name: 'List options'}).first().click()
  await page.getByRole('menuitemradio', {name: 'Select documents'}).click()
  for (const name of ['Alan Turing', 'Grace Hopper']) await page.getByRole('checkbox', {name: `Select ${name}`}).check()
  await page.getByRole('button', {name: 'Unpublish selected'}).click()
  const bulk = page.getByRole('dialog', {name: 'Unpublish 2 documents?'})
  await expect(bulk.getByRole('region')).toHaveCount(2)
  await page.screenshot({path: 'evidence/B07-2-bulk-studio.png'})
  await bulk.getByRole('button', {name: 'Cancel'}).click()
})

// LiveView's third answer: "Disconnect references and unpublish" takes the references
// out of the documents that hold them (Barkpark's disconnect), then unpublishes. On an
// author and a post of the test's own, deleted after.
const AUTHOR = 'author-b07-disconnect'
const POST = 'post-b07-disconnect'
const read = (type: string, id: string, perspective: string) =>
  fetch(`${base().replace(/\/author$/, `/${type}`)}/${id}?perspective=${perspective}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}}).then((r) => (r.ok ? r.json().then((j) => j.result as Record<string, unknown>) : null))
test('@local B07: Disconnect references and unpublish', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: Sanity blocks only delete')
  await bpMutate([{delete: {id: POST, type: 'post', force: true}}, {delete: {id: AUTHOR, type: 'author', force: true}}]).catch(() => {})
  await bpMutate([
    {createOrReplace: {_id: AUTHOR, _type: 'author', name: 'B07 Disconnect'}},
    {createOrReplace: {_id: POST, _type: 'post', title: 'B07 referrer', slug: {_type: 'slug', current: 'b07-referrer'}, author: {_type: 'reference', _ref: AUTHOR}}},
    {publish: {id: AUTHOR, type: 'author'}},
    {publish: {id: POST, type: 'post'}},
  ])
  try {
    await page.goto(`${t.docPath('author', AUTHOR)}?perspective=published`)
    await t.settle(page)
    await page.getByRole('button', {name: 'Unpublish', exact: true}).click()
    const dialog = page.getByRole('dialog', {name: 'Unpublish document?'})
    await expect(dialog.locator('.used-in li')).toHaveCount(1, {timeout: 10_000})
    await page.screenshot({path: 'evidence/B07-3-disconnect-studio.png'})
    await dialog.getByRole('button', {name: 'Disconnect references and unpublish'}).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => live(AUTHOR)).toBe(false)
    await expect.poll(async () => (await read('post', POST, 'drafts'))?.author ?? null).toBeNull()
    expect(await read('post', POST, 'drafts'), 'the referrer itself stays').not.toBeNull()
  } finally {
    await bpMutate([{delete: {id: POST, type: 'post', force: true}}, {delete: {id: AUTHOR, type: 'author', force: true}}]).catch(() => {})
  }
})
