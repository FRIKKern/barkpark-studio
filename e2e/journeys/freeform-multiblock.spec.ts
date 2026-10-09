import {expect, test, type Page} from '@playwright/test'
import {resetNative, target, type Target, closeAndSettle} from '../rig/targets'

// D16, Barkdown's EDITOR-PARITY row 11 (app/tests/editor-multiblock.live.mjs) on our
// canvas: multi-block edits across the ops round trip. After every step the canvas's
// block list and Barkpark's agree. paper-02 is a published paper, so cut-all meets
// Barkpark's wall (a paper cannot be hollowed out): the card says why, the author's
// state stays, and the next edit (pasting back) saves.
const ID = 'paper-02'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio') await resetNative(ID, 'paper')
})

type Inline = {type?: string; text?: string; value?: string; content?: Inline[]}
const text = (a: Inline[] | undefined): string => (a ?? []).map((x) => x.text ?? x.value ?? text(x.content)).join('')
// Both sides as "kind:text", the bound title left out (it is a field, not body).
const canvasShape = (page: Page) =>
  page.evaluate(() => {
    const inline = (n: {text?: string; content?: unknown[]}): string => ((n.content ?? []) as {type: string; text?: string; content?: unknown[]}[]).map((x) => (x.type === 'text' ? x.text ?? '' : inline(x))).join('')
    const ed = (document.querySelector('bp-paper-canvas') as HTMLElement & {_editor: {getJSON(): {content: {type: string; content?: unknown[]}[]}}})._editor
    return ed
      .getJSON()
      .content.filter((n) => n.type !== 'bpField')
      .map((n) => (/List$/.test(n.type) ? `list:${(n.content as {content?: unknown[]}[]).map((i) => inline(i)).join('|')}` : `${n.type}:${inline(n)}`))
  })
const serverShape = async (t: Target) =>
  ((await t.docValue(ID, 'blocks', 'paper')) as {type: string; text?: string; content?: Inline[]; items?: (Inline[] | {content?: Inline[]})[]}[])
    .filter((b) => !b.type.startsWith('field-'))
    // A block may carry its words as plain `text` (a heading the canvas wrote) or as runs.
    .map((b) => (b.type === 'list' ? `list:${(b.items ?? []).map((i) => (Array.isArray(i) ? text(i) : text(i.content))).join('|')}` : `${b.type}:${b.text ?? text(b.content)}`))

/** Select from inside one text to inside another through ProseMirror, as Barkdown's probe does. */
const selectBetween = (page: Page, a: string, ao: number, b: string, bo: number) =>
  page.evaluate(
    ([a, ao, b, bo]) => {
      const ed = (document.querySelector('bp-paper-canvas') as HTMLElement & {_editor: {state: {doc: {descendants(f: (n: {isText: boolean; text?: string}, pos: number) => void): void}}; commands: {setTextSelection(r: {from: number; to: number}): void; focus(): void}}})._editor
      let from: number | null = null
      let to: number | null = null
      ed.state.doc.descendants((n, pos) => {
        if (!n.isText || !n.text) return
        if (from == null && n.text.includes(a as string)) from = pos + n.text.indexOf(a as string) + (ao as number)
        if (to == null && n.text.includes(b as string)) to = pos + n.text.indexOf(b as string) + (bo as number)
      })
      ed.commands.setTextSelection({from: from!, to: to!})
      ed.commands.focus()
    },
    [a, ao, b, bo] as const,
  )

/** Put the caret at the end of the block holding `text` (a click does not always leave a live selection). */
const caretAtEnd = (page: Page, text: string) =>
  page.evaluate((txt) => {
    type Node = {isTextblock: boolean; textContent: string; nodeSize: number}
    const ed = (document.querySelector('bp-paper-canvas') as HTMLElement & {_editor: {state: {doc: {descendants(f: (n: Node, pos: number) => void): void}}; commands: {setTextSelection(p: number): void; focus(): void}}})._editor
    let at: number | null = null
    ed.state.doc.descendants((n, pos) => void (at == null && n.isTextblock && n.textContent.includes(txt) && (at = pos + n.nodeSize - 1)))
    ed.commands.setTextSelection(at!)
    ed.commands.focus()
  }, text)

/** Paste what the last copy put on the clipboard, replayed from the copy event when the OS clipboard is not there. */
const paste = async (page: Page) => {
  const before = (await canvasShape(page)).length
  await page.keyboard.press(`${MOD}+v`)
  await page.waitForTimeout(300)
  if ((await canvasShape(page)).length !== before) return
  await page.evaluate(() => {
    const c = (window as unknown as {clip?: {html: string; text: string}}).clip
    if (!c) return
    const dt = new DataTransfer()
    if (c.html) dt.setData('text/html', c.html)
    if (c.text) dt.setData('text/plain', c.text)
    const ed = (document.querySelector('bp-paper-canvas') as HTMLElement & {_editor: {view: {dom: HTMLElement}}})._editor
    ed.view.dom.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}))
  })
}

test('@local D16: multi-block edits — merge, paste three, spanning delete, cut-all wall, select-all type; canvas and server agree', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  test.setTimeout(120_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await t.prepare(context)
  await page.goto(t.docPath('paper', ID))
  await t.settle(page)
  const pm = page.locator('bp-paper-canvas .ProseMirror')
  await expect(pm).toBeVisible({timeout: 20_000})
  // What ProseMirror puts on the clipboard, for the replayed paste.
  await page.evaluate(() => document.addEventListener('copy', (e) => void ((window as unknown as {clip: unknown}).clip = {html: e.clipboardData?.getData('text/html') ?? '', text: e.clipboardData?.getData('text/plain') ?? ''})))
  const status = page.locator('.pd-status')
  // Saved, then canvas and server agree (polled: the server read follows the save).
  const agree = async () => {
    await expect(status).toHaveText('Saved', {timeout: 15_000})
    const canvas = await canvasShape(page)
    await expect.poll(() => serverShape(t), {timeout: 10_000}).toEqual(canvas)
    return canvas
  }
  const original = await agree()
  expect(original).toHaveLength(6)
  const undo = async () => {
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => canvasShape(page)).toEqual(original)
    expect(await agree()).toEqual(original)
  }

  // Select across two paragraphs and type: they merge.
  await selectBetween(page, 'First paragraph here.', 16, 'Second paragraph here.', 5)
  await page.keyboard.type('joined')
  let now = await agree()
  expect(now).toHaveLength(5)
  expect(now.some((s) => s.includes('joined'))).toBe(true)
  await undo()

  // Copy three whole blocks, paste after the last: three appended.
  await selectBetween(page, 'First paragraph', 0, 'Third paragraph here.', 'Third paragraph here.'.length)
  await page.keyboard.press(`${MOD}+c`)
  await caretAtEnd(page, 'Closing line.')
  await page.keyboard.press('Enter')
  await paste(page)
  now = await agree()
  expect(now).toHaveLength(9)
  expect(now.slice(-3)).toEqual(original.slice(1, 4))
  await page.keyboard.press(`${MOD}+z`)
  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(() => canvasShape(page)).toEqual(original)
  await agree()

  // Delete a selection spanning a paragraph and a list.
  await selectBetween(page, 'Third paragraph', 5, 'beta item', 4)
  await page.keyboard.press('Backspace')
  now = await agree()
  expect(now.length).toBeLessThan(original.length)
  expect(now.some((s) => s.startsWith('paragraph:Third') && s.includes('item'))).toBe(true)
  await undo()

  // Cut everything: Barkpark's wall refuses an empty paper; the card says why and
  // the author's state stays. Pasting back is the next edit, and it saves.
  await caretAtEnd(page, 'Closing line.')
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.press(`${MOD}+x`)
  const card = page.locator('.pd-conflict')
  await expect(card).toContainText(/hollow|last content block/i, {timeout: 15_000})
  await expect(status).toHaveText('Not saved')
  expect((await canvasShape(page)).length).toBeLessThanOrEqual(1)
  expect(await serverShape(t)).toEqual(original)
  await paste(page)
  expect(await agree()).toEqual(original)
  await expect(card).toHaveCount(0)

  // Select all and type: one paragraph; undo brings the paper back.
  await caretAtEnd(page, 'Closing line.')
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.type('fresh start')
  now = await agree()
  expect(now).toEqual(['paragraph:fresh start'])
  await undo()

  // Reload: the paper comes back from the server as the canvas last showed it.
  await page.reload()
  await t.settle(page)
  await expect(pm).toBeVisible({timeout: 20_000})
  await expect.poll(() => canvasShape(page), {timeout: 10_000}).toEqual(original)
  await page.screenshot({path: 'evidence/D16-studio.png'})
})
