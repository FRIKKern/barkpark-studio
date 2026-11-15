import {expect, test, type Page} from '../rig/test'
import {bpBase, bpDataset, bpMutate, signInIfAsked, target} from '../rig/targets'

// J40 on a Portable Text field (ours: the reference can't save a comment): selecting text
// offers Sanity's "Add comment" by it, the span is marked while it is written about and once
// saved, the caret goes back to the text, and after a reload the span is still marked on its
// words and opens its thread. The marks are CSS highlights over the editor's own text (nothing
// is put in it), so they are read from the page's highlight registry. A scratch doc on the
// lane's dataset, removed afterwards with its comment.
const ID = `post-pt-inline-c-${Date.now().toString(36)}`
const BODY = [{_key: 'p1', _type: 'block', style: 'normal', markDefs: [], children: [{_key: 'p1s1', _type: 'span', marks: [], text: 'Alpha beta gamma delta.'}]}]
const marked = (page: Page) => page.evaluate(() => ['bp-comment', 'bp-comment-active'].flatMap((name) => [...(CSS.highlights.get(name) ?? [])]).map((r) => r.toString()))
const select = (page: Page, word: string) =>
  page.evaluate((word) => {
    const w = document.createTreeWalker(document.querySelector('[id="ptBody"]')!, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.textContent!.indexOf(word)
      if (i < 0) continue
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + word.length)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(r)
      return
    }
  }, word)
/** The field's editor, once it has read its value. */
async function editor(page: Page) {
  await page.getByRole('tab', {name: 'All fields'}).click()
  await page.locator('.pt-input[data-ready]').filter({has: page.locator('[id="ptBody"]')}).waitFor()
  return page.locator('[id="ptBody"]')
}

const comments = async () => {
  const r = await fetch(`${bpBase()}/v1/data/query/${bpDataset()}/studioComment?perspective=drafts&limit=50&filter[documentId][eq]=${ID}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  return ((await r.json().catch(() => null)) as {result?: {documents?: {_id: string; selection?: unknown; textDeleted?: boolean}[]}} | null)?.result?.documents ?? []
}

test.afterEach(async () => {
  const ids = (await comments()).map((d) => d._id)
  await bpMutate([...ids.map((id) => ({delete: {id, type: 'studioComment'}})), {delete: {id: ID, type: 'post', force: true}}]).catch(() => {})
})

test('J40: a comment on a span of a Portable Text field is saved on its words and opens its thread', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "the reference can't save a comment")
  await t.draftOnly(ID, 'post', {title: 'Inline comments, Portable Text', ptBody: BODY})
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  let text = await editor(page)
  await text.getByText(/Alpha beta/).click()
  await expect(text).toBeFocused()
  await select(page, 'gamma')
  await page.locator('.inline-comment-add').click()
  await expect(page.getByRole('textbox', {name: 'Add comment to Portable Text body'})).toBeFocused()
  expect(await marked(page)).toEqual(['gamma'])
  await page.keyboard.type('On gamma')
  await page.keyboard.press('Enter')
  const panel = page.locator('.inspector.comments')
  await expect(panel.locator('.commented-text')).toHaveText('gamma')
  await expect(text).toBeFocused()

  await page.reload()
  await t.settle(page)
  text = await editor(page)
  await expect.poll(() => marked(page), {timeout: 10_000}).toEqual(['gamma'])
  // A click on the marked words picks their thread.
  await text.scrollIntoViewIfNeeded()
  const at = await page.evaluate(() => [...CSS.highlights.get('bp-comment')!][0]!.getBoundingClientRect().toJSON() as DOMRect)
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2)
  await expect(panel.locator('.comment-thread[data-active]')).toContainText('On gamma')
})

// Review of #1248: the form stays mounted when it shows the published version, and its text
// coming in was read as an edit: the span was mapped onto it and saved (moved, or deleted for
// good) with nothing typed. Looking is not editing: no span is painted on the other version,
// and the saved one is the same after coming back. @local: it waits out the save's 1.2 s three times.
test('@local J40: looking at the published version does not move a Portable Text comment span; typing does', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "the reference can't save a comment")
  const body = (text: string) => [{...BODY[0]!, children: [{...BODY[0]!.children[0]!, text}]}]
  await t.draftOnly(ID, 'post', {title: 'Inline comments, Portable Text', ptBody: body('Alpha beta delta.')})
  await bpMutate([{publish: {id: ID, type: 'post'}}])
  await bpMutate([{patch: {id: ID, type: 'post', set: {ptBody: BODY}}}])
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const text = await editor(page)
  await expect(text).toContainText('gamma')
  await text.getByText(/Alpha beta/).click()
  await expect(text).toBeFocused()
  await select(page, 'gamma')
  await page.locator('.inline-comment-add').click()
  await page.keyboard.type('On gamma')
  await page.keyboard.press('Enter')
  await expect(page.locator('.inspector.comments .commented-text')).toHaveText('gamma')
  const before = (await comments())[0]!.selection
  expect(before).toEqual({anchor: {blockId: 'p1', offset: 11}, head: {blockId: 'p1', offset: 16}})

  await page.getByRole('button', {name: 'Published', exact: true}).click()
  await expect(page.locator('[id="ptBody"]')).not.toContainText('gamma')
  await expect.poll(() => marked(page)).toEqual([])
  await page.waitForTimeout(2000)
  expect((await comments())[0]).toMatchObject({selection: before})
  await page.getByRole('button', {name: /^Draft/}).first().click()
  await expect(page.locator('[id="ptBody"]')).toContainText('gamma')
  await expect.poll(() => marked(page)).toEqual(['gamma'])
  await page.waitForTimeout(2000)
  const after = (await comments())[0]!
  expect(after.selection).toEqual(before)
  expect(after.textDeleted ?? false).toBe(false)
  expect(await marked(page)).toEqual(['gamma'])

  // Typing is editing: the span moves with its words, and where it went is saved.
  await page.locator('[id="ptBody"]').getByText(/Alpha beta/).click({position: {x: 2, y: 8}})
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
  await page.keyboard.type('Zero ')
  await expect.poll(() => marked(page)).toEqual(['gamma'])
  await expect.poll(async () => (await comments())[0]!.selection, {timeout: 10_000}).toEqual({anchor: {blockId: 'p1', offset: 16}, head: {blockId: 'p1', offset: 21}})
})
