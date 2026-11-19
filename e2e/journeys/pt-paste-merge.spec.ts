import {expect, test, type Locator, type Page} from '../rig/test'
import {bpMutate, closeAndSettle, savesLanded, target} from '../rig/targets'
import {readDoc} from '../rig/portable-text'

// task-7777e1ba8c35d896: two editors paste into one rich-text block at once. One pastes a
// line at its end (saved by the block's key), the other three paragraphs at its start
// (the paste splits the block: the field goes whole). Both texts are stored, each once, and
// both editors show what is stored. Main kept the later writer's block whole: the other's
// paste was gone, or the block's text was there twice (lib/pt-merge.ts).
const ID = `post-paste-${Date.now().toString(36)}`
const blk = (key: string, text: string) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: [{_type: 'span', _key: `${key}s`, text, marks: []}]})

test.setTimeout(45_000)
test.beforeEach(async ({}, info) => {
  test.skip(target(info).name === 'sanity', 'ours: the merge of two editors\' saves')
  await bpMutate([{createOrReplace: {_id: ID, _type: 'post', title: 'Paste notes', body: [blk('p0', 'Kettle on.'), blk('p1', 'Start text'), blk('p2', 'Cups out.')]}}])
})
test.afterEach(async () => void (await bpMutate([{delete: {id: ID, type: 'post', force: true}}]).catch(() => {})))

async function open(page: Page, info: import('@playwright/test').TestInfo, end: boolean): Promise<Locator> {
  const t = target(info)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'All fields'}).click()
  const editor = page.locator('[id="body"][contenteditable="true"]')
  await page.locator('.pt-input[data-ready]').filter({has: editor}).waitFor()
  await editor.getByText('Start text', {exact: true}).click()
  await editor.evaluate((el, end) => {
    const node = [...el.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent === 'Start text')!.firstChild!
    getSelection()!.collapse(node, end ? 'Start text'.length : 0)
  }, end)
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
const WANT = ['Kettle on.', 'x', 'y', 'zStart textone two three', 'Cups out.']

for (const apart of [0, 1000])
  test(`Portable Text: two editors pasting into one block ${apart ? '1 s apart' : 'at once'} both keep their text, once`, async ({page, browser}, info) => {
    const ctxB = await browser.newContext()
    await target(info).prepare(ctxB)
    const b = await ctxB.newPage()
    try {
      const [edA, edB] = await Promise.all([open(page, info, true), open(b, info, false)])
      await paste(edA, ' one two three')
      await b.waitForTimeout(apart)
      await paste(edB, 'x\n\ny\n\nz ')
      await Promise.all([savesLanded(page), savesLanded(b)])
      await expect.poll(stored, {timeout: 15_000}).toEqual(WANT)
      await expect.poll(() => lines(edA), {timeout: 15_000}).toEqual(WANT)
      await expect.poll(() => lines(edB), {timeout: 15_000}).toEqual(WANT)
    } finally {
      await closeAndSettle(b)
      await ctxB.close()
      await closeAndSettle(page)
    }
  })

// task-2c01c385ce7b51d0: the same two pastes, while A's save is out (held) and A reloads before
// it lands, its unload beacon failing too: the edits kept in this browser are all that is left.
// Restored over B's paste (B's paragraphs at the block's start: its key stays on "x"), A's line
// goes back after the block's text. Both texts once.
test('@local Portable Text: a paste kept while its page reloads mid-save, the other pasting into the block, both kept once', async ({page, browser}, info) => {
  const ctxB = await browser.newContext()
  await target(info).prepare(ctxB)
  const b = await ctxB.newPage()
  try {
    // page.route never sees sendBeacon: it fails here, and each call is counted.
    await page.addInitScript(() => {
      navigator.sendBeacon = () => (localStorage.setItem('e2eBeacons', String(Number(localStorage.getItem('e2eBeacons') ?? 0) + 1)), false)
    })
    const [edA, edB] = await Promise.all([open(page, info, true), open(b, info, false)])
    // A's saves hang (a slow connection) until the page goes; `held` counts them.
    let held = 0
    const slow = (route: import('@playwright/test').Route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? void held++ : route.continue())
    await page.route('**/_serverFn/**', slow)
    await paste(edA, ' one two three')
    await page.waitForTimeout(600) // kept in this browser
    await paste(edB, 'x\n\ny\n\nz ')
    await savesLanded(b)
    await expect.poll(() => held, {timeout: 10_000}).toBeGreaterThan(0)
    // …and kept in this browser (edits.ts writes it KEEP_GAP_MS after the edit): the reload comes after that.
    const keptHere = () =>
      page.evaluate(
        () =>
          new Promise<number>((res) => {
            const q = indexedDB.open('bp-pending-edits')
            q.onsuccess = () => {
              try {
                const c = q.result.transaction('docs').objectStore('docs').count()
                c.onsuccess = () => res(c.result)
                c.onerror = () => res(0)
              } catch {
                res(0)
              }
            }
            q.onerror = () => res(0)
          }),
      )
    await expect.poll(keptHere, {timeout: 5_000}).toBeGreaterThan(0)
    // A reload right as the kept entry appears can put it back with no Restore card (seen on main
    // too): task-e437f5ba355f317e. This scene reloads a moment later.
    await page.waitForTimeout(1_000)
    await page.reload()
    await page.unroute('**/_serverFn/**', slow)
    await target(info).settle(page)
    await page.getByRole('tab', {name: 'All fields'}).click()
    expect(Number(await page.evaluate(() => localStorage.getItem('e2eBeacons')))).toBeGreaterThan(0) // the unload tried it
    const card = page.getByTestId('kept-edits')
    await card.getByRole('button', {name: 'Restore'}).click()
    await savesLanded(page)
    await expect.poll(stored, {timeout: 15_000}).toEqual(WANT)
    const again = page.locator('[id="body"][contenteditable="true"]')
    await expect.poll(() => lines(again), {timeout: 15_000}).toEqual(WANT)
    await expect.poll(() => lines(edB), {timeout: 15_000}).toEqual(WANT)
  } finally {
    await closeAndSettle(b)
    await ctxB.close()
    await closeAndSettle(page)
  }
})

// task-28470f0d0ace566c: as above, but B rewrites the block ("A dog") while A's line is kept. Where
// the line goes cannot be told (the text it touched is gone): B's text stays, and the card stays up,
// saying it could not be put back, with A's text to copy. It is still offered after a reload.
test('@local Portable Text: a line kept while its page reloads mid-save, the other rewriting the block: not put back, still offered with its text', async ({page, browser}, info) => {
  const ctxB = await browser.newContext()
  await target(info).prepare(ctxB)
  const b = await ctxB.newPage()
  try {
    await page.addInitScript(() => {
      navigator.sendBeacon = () => false
    })
    const [edA, edB] = await Promise.all([open(page, info, true), open(b, info, false)])
    let held = 0
    const slow = (route: import('@playwright/test').Route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? void held++ : route.continue())
    await page.route('**/_serverFn/**', slow)
    await paste(edA, ' one two three')
    await page.waitForTimeout(600) // kept in this browser
    // B selects the block's text (ProseMirror reads the selection on selectionchange), then pastes over it.
    await edB.evaluate((el) => {
      const node = [...el.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent === 'Start text')!.firstChild!
      getSelection()!.setBaseAndExtent(node, 0, node, 'Start text'.length)
    })
    await b.waitForTimeout(200)
    await paste(edB, 'A dog')
    await savesLanded(b)
    await expect.poll(stored, {timeout: 10_000}).toEqual(['Kettle on.', 'A dog', 'Cups out.'])
    await expect.poll(() => held, {timeout: 10_000}).toBeGreaterThan(0)
    await page.waitForTimeout(1_000) // kept in this browser, and a moment more (task-e437f5ba355f317e)
    await page.reload()
    await page.unroute('**/_serverFn/**', slow)
    await target(info).settle(page)
    await page.getByRole('tab', {name: 'All fields'}).click()
    const card = page.getByTestId('kept-edits')
    await card.getByRole('button', {name: 'Restore'}).click()
    await expect(card).toContainText('could not be put back: the text changed since')
    // The paste here drops the leading space today; this line and WANT gain the space when the paste keeps it.
    await expect(card.getByTestId('kept-text')).toHaveText('Start textone two three')
    await expect(card.getByRole('button', {name: 'Restore'})).toHaveCount(0)
    await page.waitForTimeout(1_000)
    expect(await stored()).toEqual(['Kettle on.', 'A dog', 'Cups out.'])
    // Still kept in this browser: offered again after a reload.
    await page.reload()
    await target(info).settle(page)
    await page.getByRole('tab', {name: 'All fields'}).click()
    await expect(page.getByTestId('kept-edits')).toBeVisible({timeout: 8_000})
    expect(await stored()).toEqual(['Kettle on.', 'A dog', 'Cups out.'])
  } finally {
    await closeAndSettle(b)
    await ctxB.close()
    await closeAndSettle(page)
  }
})
