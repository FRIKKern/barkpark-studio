import {expect, test, type Locator, type Page} from '../rig/test'
import {bpMutate, closeAndSettle, savesLanded, target} from '../rig/targets'
import {readDoc} from '../rig/portable-text'

// task-30946f2255a30d93, task-ab6d751fa53fbda5: typing goes to Barkpark as a span patch, put
// on the span's text as it is there. When the other editor's paste split that block
// meanwhile, the span holds only the head of its text: typed words went to the wrong block,
// and letters deleted at its end came back. Now the span's field is merged from what it was
// before the patch (lib/pt-span.ts): every paste and word once, deleted letters deleted, and
// both editors show what is stored.
const ID = `post-span-${Date.now().toString(36)}`
const blk = (key: string, text: string) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: [{_type: 'span', _key: `${key}s`, text, marks: []}]})

test.setTimeout(45_000)
test.beforeEach(async ({}, info) => {
  test.skip(target(info).name === 'sanity', "ours: the merge of two editors' saves")
  await bpMutate([{createOrReplace: {_id: ID, _type: 'post', title: 'Span notes', body: [blk('p0', 'Kettle on.'), blk('p1', 'Start text'), blk('p2', 'Cups out.')]}}])
})
test.afterEach(async () => void (await bpMutate([{delete: {id: ID, type: 'post', force: true}}]).catch(() => {})))

/** The page, its caret in "Start text" at `at`. */
async function open(page: Page, info: import('@playwright/test').TestInfo, at: number): Promise<Locator> {
  const t = target(info)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'All fields'}).click()
  const editor = page.locator('[id="body"][contenteditable="true"]')
  await page.locator('.pt-input[data-ready]').filter({has: editor}).waitFor()
  await editor.getByText('Start text', {exact: true}).click()
  await editor.evaluate((el, at) => {
    const node = [...el.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent === 'Start text')!.firstChild!
    getSelection()!.collapse(node, at)
  }, at)
  await page.waitForTimeout(200)
  return editor
}
const paste = (editor: Locator, text: string) =>
  editor.evaluate((el, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}))
  }, text)
const stored = async () => (((await readDoc(ID, 'drafts'))?.body ?? []) as {children?: {text: string}[]}[]).map((b) => b.children?.map((c) => c.text).join('') ?? '')
const lines = (editor: Locator) => editor.innerText().then((t) => t.split('\n').filter(Boolean))

/** Each word once in `lines` (a word typed or pasted, or a block's text). */
const once = (lines: string[], words: string[]) => words.filter((w) => lines.join('\n').split(w).length !== 2)

/**
 * `want`: the stored blocks, or the words each stored once (where a caret goes after the other
 * editor's split is not this test's: task-ff8c87d24c11050c). Both screens show what is stored.
 */
async function twoEditors(page: Page, browser: import('@playwright/test').Browser, info: import('@playwright/test').TestInfo, run: (a: Page, b: Page, edA: Locator, edB: Locator) => Promise<void>, want: string[] | {words: string[]}) {
  const ctxB = await browser.newContext()
  await target(info).prepare(ctxB)
  const b = await ctxB.newPage()
  try {
    // A's caret at the end of "Start text"; B's after "Start ", where its paste splits the block.
    const [edA, edB] = await Promise.all([open(page, info, 'Start text'.length), open(b, info, 'Start '.length)])
    await run(page, b, edA, edB)
    await Promise.all([savesLanded(page), savesLanded(b)])
    if (Array.isArray(want)) await expect.poll(stored, {timeout: 15_000}).toEqual(want)
    else await expect.poll(async () => once(await stored(), want.words), {timeout: 15_000}).toEqual([])
    const now = await stored()
    await expect.poll(() => lines(edA), {timeout: 15_000}).toEqual(now)
    await expect.poll(() => lines(edB), {timeout: 15_000}).toEqual(now)
  } finally {
    await closeAndSettle(b)
    await ctxB.close()
    await closeAndSettle(page)
  }
}

test('Portable Text: two editors paste into one block and type on, one paste splitting it: every paste and word once, on both screens', async ({page, browser}, info) =>
  twoEditors(
    page,
    browser,
    info,
    async (a, b, edA, edB) => {
      await paste(edA, 'one two')
      await a.keyboard.type(' four five', {delay: 40})
      await paste(edB, 'QQ\n\nrr')
      await b.keyboard.type('ss ', {delay: 40})
      await a.keyboard.type(' six', {delay: 40})
    },
    {words: ['Kettle on.', 'Start', 'QQ', 'rr', 'ss', 'text', 'one two', 'four five', 'six', 'Cups out.']},
  ))

test("Portable Text: letters deleted at a block's end while another editor's paste splits it stay deleted, on both screens", async ({page, browser}, info) =>
  twoEditors(
    page,
    browser,
    info,
    async (a, b, edA, edB) => {
      await a.keyboard.press('Backspace')
      await paste(edB, 'QQ\n\nrr')
      await a.keyboard.press('Backspace')
      await a.waitForTimeout(100)
      await a.keyboard.press('Backspace')
    },
    ['Kettle on.', 'Start QQ', 'rrt', 'Cups out.'],
  ))
