import {expect, test} from '../rig/test'
import {bpMutate, closeAndSettle, savesLanded, target} from '../rig/targets'
import {BODY, openBody, readDoc, selectWarm} from '../rig/portable-text'

// S4a (task-7f77f41c95cc6d9f), a Portable Text field edited in place: one word edited
// changes that span only, every _key kept, and both ways of discarding the draft leave the
// published doc as it was. Opening and closing it writes nothing, and the toolbar's tools:
// portable-text.spec (split from it for CI's shards, task-c1df532bed870536).
const ID = `post-pt-edit-${Date.now().toString(36)}`
const read = (perspective: 'drafts' | 'published') => readDoc(ID, perspective)
const open = (page: import('@playwright/test').Page, info: import('@playwright/test').TestInfo) => openBody(page, info, ID)

test.setTimeout(45_000)
test.beforeEach(async ({}, info) => {
  test.skip(target(info).name === 'sanity', 'ours: Sanity has its own Portable Text input')
  await bpMutate([{createOrReplace: {_id: ID, _type: 'post', title: 'Tea notes', body: BODY}}, {publish: {id: ID, type: 'post'}}])
})
test.afterEach(async ({page}) => (await closeAndSettle(page), await bpMutate([{delete: {id: ID, type: 'post', force: true}}]).catch(() => {})))


test('Portable Text: one word edited changes that span only, keys and unknown content kept, discard leaves published as it was', async ({page}, info) => {
  const published = await read('published')
  const stored = JSON.parse(JSON.stringify(published!.body)) as typeof BODY
  const editor = await open(page, info)
  await selectWarm(page, editor)
  await page.keyboard.type('hot')
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('Brew the tea with hot water.')
  const draft = (await read('drafts'))!.body as typeof BODY
  // Only that span's text differs; every block and span keeps its key.
  const expected = JSON.parse(JSON.stringify(stored)) as typeof BODY
  expected[0].children[0].text = 'Brew the tea with hot water.'
  expect(draft).toEqual(expected)
  // Custom block, inline object, unknown mark and markDef: byte for byte as stored.
  for (const i of [1, 2, 3, 4]) expect(JSON.stringify(draft[i])).toBe(JSON.stringify(stored[i]))
  // Discard the draft: the published doc is untouched.
  await bpMutate([{discardDraft: {id: ID, type: 'post'}}])
  const after = await read('published')
  expect(after?._rev).toBe(published?._rev)
  expect(JSON.stringify(after?.body)).toBe(JSON.stringify(published?.body))
})

// task-0b78ed09edd97e6f: after Discard changes the editor kept the discarded words on screen
// while the stored value was the published one; the next key would have written them back.
test('Portable Text: Discard changes puts the published text back in the editor', async ({page}, info) => {
  const t = target(info)
  const editor = await open(page, info)
  await selectWarm(page, editor)
  await page.keyboard.type('hot')
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('Brew the tea with hot water.')
  await t.docMenu(page).click()
  await page.getByRole('menuitem', {name: /Discard changes/}).click()
  const discard = page.getByRole('dialog').getByRole('button', {name: /^Discard changes$/})
  await discard.click()
  await expect(editor).toContainText('Brew the tea with warm water.')
  await expect(editor).not.toContainText('hot water')
})
