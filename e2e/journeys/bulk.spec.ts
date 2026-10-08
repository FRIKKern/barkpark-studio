import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// B03 (Barkpark-native, ours only), after LiveView's bulk bar: tick note rows (keyboard:
// Tab + Space), Publish selected → each doc on its own, one summary ("Published 2 of 3"
// and why the third was left); Unpublish selected asks first. The server holds each.
const IDS = ['note-01', 'note-02', 'note-03']
const SEED_LABEL = {'note-01': 'Idea', 'note-02': 'Draft', 'note-03': 'Idea'} as Record<string, string>
const versions = async (t: ReturnType<typeof target>, id: string) => {
  const base = `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/data/doc/${process.env.BARKPARK_DATASET}/note/${id}`
  const get = (p: string) => fetch(`${base}?perspective=${p}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}}).then((r) => (r.ok ? r.json() : null))
  const [d, p] = await Promise.all([get('drafts'), get('published')])
  return `${d?.result?._draft ? 'draft' : 'no draft'}, ${p?.result ? 'published' : 'not published'}`
}
test.afterEach(async ({}, info) => {
  const t = target(info)
  if (t.name === 'studio') for (const id of IDS) await t.restore(id, {label: SEED_LABEL[id]}, 'note')
})

test('@local B03: tick rows, publish and unpublish them in one go', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: Sanity has no bulk actions')
  // Two notes with a draft to publish; note-01 has none.
  for (const id of ['note-02', 'note-03']) await fetch(`${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/data/mutate/${process.env.BARKPARK_DATASET}`, {method: 'POST', headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`, 'content-type': 'application/json'}, body: JSON.stringify({mutations: [{patch: {id, type: 'note', set: {label: 'B03 draft'}}}]})})
  await page.goto(t.listPath('note'))
  await t.settle(page)
  const box = (n: string) => page.getByRole('checkbox', {name: `Select Fixture note ${n}`})
  // Keyboard: Tab onto the first tick, Space; then the others.
  await page.getByRole('searchbox', {name: 'Search list'}).focus()
  await page.keyboard.press('Tab')
  await expect(box('03')).toBeFocused()
  await page.keyboard.press('Space')
  await box('02').check()
  await box('01').check()
  const bar = page.getByRole('region', {name: 'Bulk actions'})
  await expect(bar.getByRole('status')).toHaveText('3 selected')
  await page.screenshot({path: 'evidence/B03-1-ticked-studio.png'})
  await bar.getByRole('button', {name: 'Publish selected', exact: true}).click()
  await expect(page.locator('.toast').last()).toContainText('Published 2 of 3')
  await expect(page.locator('.toast').last()).toContainText('1 had no changes to publish.')
  await expect(bar).toBeHidden()
  for (const id of IDS) expect(await versions(t, id), id).toBe('no draft, published')

  await box('02').check()
  await box('03').check()
  await bar.getByRole('button', {name: 'Unpublish selected'}).click()
  const dialog = page.getByRole('dialog', {name: 'Unpublish 2 documents?'})
  await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused()
  await dialog.getByRole('button', {name: 'Unpublish now'}).click()
  await expect(page.locator('.toast').last()).toContainText('Unpublished 2 of 2')
  await expect.poll(() => Promise.all(['note-02', 'note-03'].map((id) => versions(t, id)))).toEqual(['draft, not published', 'draft, not published'])
  await page.screenshot({path: 'evidence/B03-2-unpublished-studio.png'})
})
