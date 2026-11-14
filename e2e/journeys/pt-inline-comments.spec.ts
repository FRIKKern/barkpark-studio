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

test.afterEach(async () => {
  const r = await fetch(`${bpBase()}/v1/data/query/${bpDataset()}/studioComment?perspective=drafts&limit=50&filter[documentId][eq]=${ID}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  const ids = (((await r.json().catch(() => null)) as {result?: {documents?: {_id: string}[]}} | null)?.result?.documents ?? []).map((d) => d._id)
  await bpMutate([...ids.map((id) => ({delete: {id, type: 'studioComment'}})), {delete: {id: ID, type: 'post'}}]).catch(() => {})
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
