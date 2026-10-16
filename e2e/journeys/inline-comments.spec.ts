import {expect, test, type Page} from '@playwright/test'
import {bpMutate, bpBase, bpDataset, signInIfAsked, target} from '../rig/targets'

// J40 widen, ours (the reference can't save a comment): a comment on a span of the body.
// Selecting text offers Sanity's "Add comment" under the selection's start; the span is
// painted while it is written about and once saved; typing before it or inside it moves
// it with its words, and it survives a reload; when its words are deleted the thread
// stays, its quote unlinked. A scratch doc on the lane's dataset, removed afterwards.
const ID = `post-inline-c-${Date.now().toString(36)}`
const spans = (page: Page) => page.locator('[id="body"] .bp-comment-range').allInnerTexts()
const select = (page: Page, word: string) =>
  page.evaluate((word) => {
    const w = document.createTreeWalker(document.querySelector('[id="body"] .ProseMirror')!, NodeFilter.SHOW_TEXT)
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

test.afterEach(async () => {
  const r = await fetch(`${bpBase()}/v1/data/query/${bpDataset()}/studioComment?perspective=drafts&limit=50&filter[documentId][eq]=${ID}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  const ids = (((await r.json().catch(() => null)) as {result?: {documents?: {_id: string}[]}} | null)?.result?.documents ?? []).map((d) => d._id)
  await bpMutate([...ids.map((id) => ({delete: {id, type: 'studioComment'}})), {delete: {id: ID, type: 'post'}}]).catch(() => {})
})

// The CI core (J10's lesson: a save path only @local lets data loss through): a span
// commented on is saved there and is still painted after a reload.
test('J40: a comment on a span of the body is saved on its words', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "the reference can't save a comment")
  await t.draftOnly(ID, 'post', {title: 'Inline comments', body: {blocks: [{id: 'p1', type: 'paragraph', content: [{type: 'text', value: 'Alpha beta gamma delta.'}]}]}})
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.locator('[id="body"]').getByText(/Alpha beta/).click()
  await expect(page.locator('[id="body"] .ProseMirror')).toBeFocused({timeout: 10_000})
  await select(page, 'gamma')
  await page.locator('.inline-comment-add').click()
  await page.keyboard.type('On gamma')
  await page.keyboard.press('Enter')
  await expect(page.locator('.inspector.comments')).toContainText('On gamma')
  await page.reload()
  await t.settle(page)
  await page.locator('[id="body"]').getByText(/Alpha beta/).click()
  await expect.poll(() => spans(page), {timeout: 10_000}).toEqual(['gamma'])
})

test('@local J40: a comment on a span of the body follows its words, and outlives them', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "the reference can't save a comment")
  await t.draftOnly(ID, 'post', {title: 'Inline comments', body: {blocks: [{id: 'p1', type: 'paragraph', content: [{type: 'text', value: 'Alpha beta gamma delta.'}]}]}})
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.locator('[id="body"]').getByText(/Alpha beta/).click()
  await expect(page.locator('[id="body"] .ProseMirror')).toBeFocused({timeout: 15_000})

  await select(page, 'gamma')
  const offer = page.locator('.inline-comment-add')
  await expect(offer).toBeVisible()
  // Sanity's place: 8 px under the selection, 24 px left of its start.
  const sel = await page.evaluate(() => getSelection()!.getRangeAt(0).getBoundingClientRect().toJSON() as DOMRect)
  const box = (await offer.boundingBox())!
  expect([Math.round(box.x - sel.x), Math.round(box.y - sel.bottom)]).toEqual([-24, 8])
  await offer.click()
  await expect(page.getByRole('textbox', {name: 'Add comment to Body'})).toBeFocused()
  expect(await spans(page)).toEqual(['gamma'])
  await page.keyboard.type('On gamma')
  await page.keyboard.press('Enter')
  await expect(page.locator('.inspector.comments')).toContainText('On gamma')

  // Typing before the span and inside it moves it with its words.
  await page.locator('[id="body"] .ProseMirror p').first().click({position: {x: 3, y: 8}})
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
  await page.keyboard.type('Zero ')
  const hl = (await page.locator('[id="body"] .bp-comment-range').boundingBox())!
  await page.mouse.click(hl.x + hl.width / 2, hl.y + hl.height / 2)
  await page.keyboard.type('XX')
  await expect.poll(() => spans(page)).toEqual([expect.stringMatching(/^ga\w*XX\w*a$/)])
  const moved = (await spans(page))[0]!
  // Saved where it went: after a reload and a wake, the same words.
  await page.waitForTimeout(2000)
  await page.reload()
  await t.settle(page)
  await page.locator('[id="body"]').getByText(/Zero Alpha/).click()
  await expect.poll(() => spans(page), {timeout: 10_000}).toEqual([moved])

  // Its words deleted: the span goes, the thread stays with its quote unlinked.
  await select(page, moved)
  await page.keyboard.press('Backspace')
  await expect.poll(() => spans(page)).toEqual([])
  if (!(await page.locator('.inspector.comments').isVisible())) await page.getByRole('button', {name: 'Comments', exact: true}).click()
  await expect(page.locator('.inspector.comments')).toContainText('On gamma')
})
