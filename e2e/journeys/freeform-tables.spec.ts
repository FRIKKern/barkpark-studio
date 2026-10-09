import {expect, test, type Page} from '@playwright/test'
import {resetNative, target, type Target} from '../rig/targets'

// D15, Barkdown's EDITOR-PARITY row 10 (app/tests/editor-tables.live.mjs) on our
// canvas: /table inserts a table with a header row; type in cells, Tab / Shift+Tab
// (which select the cell, as TableKit does), Tab past the last cell adds a row; the
// table chrome adds and removes rows and columns; undo; a pasted GFM pipe table
// becomes a table; Enter in a cell keeps the table whole; reload. Canvas and server
// agree after each step that saves.
const ID = 'paper-03'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio') await resetNative(ID, 'paper')
})

type Ed = {
  getJSON(): {content: {type: string; content?: {content?: {type: string; content?: {text?: string; content?: {text?: string}[]}[]}[]}[]}[]}
  state: {doc: {forEach(f: (n: {type: {name: string}; textContent: string; nodeSize: number}, offset: number) => void): void; descendants(f: (n: {type: {name: string}; nodeSize: number}, pos: number) => void): void}; selection: {empty: boolean; $from: {depth: number; before(d: number): number}}}
  chain(): {focus(): {insertContentAt(p: number, c: unknown): {setTextSelection(p: number): {run(): void}}}}
  commands: {setTextSelection(p: number): void; focus(): void}
}

// The canvas tables as grids of cell texts; header cells prefixed with '#'.
const grids = (page: Page) =>
  page.evaluate(() => {
    const ed = (document.querySelector('bp-paper-canvas') as unknown as {_editor: Ed})._editor
    const text = (n: {content?: {text?: string; content?: {text?: string}[]}[]}) => (n.content ?? []).map((p) => p.text ?? (p.content ?? []).map((x) => x.text ?? '').join('')).join('')
    return ed
      .getJSON()
      .content.filter((n) => n.type === 'bpTable')
      .map((t) => (t.content ?? []).map((row) => (row.content ?? []).map((cell) => (cell.type === 'bpTableHeaderCell' ? '#' : '') + text(cell as never))))
  })
const kinds = (page: Page) => page.evaluate(() => (document.querySelector('bp-paper-canvas') as unknown as {_editor: Ed})._editor.getJSON().content.map((n) => n.type))
type Cell = {value?: string; text?: string}[] | string | {content?: {value?: string; text?: string}[]}
const cellText = (c: Cell): string => (Array.isArray(c) ? c.map((x) => x.value ?? x.text ?? '').join('') : typeof c === 'string' ? c : cellText(c.content ?? []))
const serverGrids = async (t: Target) =>
  ((await t.docValue(ID, 'blocks', 'paper')) as {type: string; head?: Cell[]; rows?: (Cell[] | {cells?: Cell[]})[]}[])
    .filter((b) => b.type === 'table')
    .map((tb) => [...(tb.head?.length ? [tb.head.map((c) => '#' + cellText(c))] : []), ...(tb.rows ?? []).map((r) => (Array.isArray(r) ? r : r.cells ?? []).map(cellText))])

const paste = (page: Page, text: string) =>
  page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.querySelector('bp-paper-canvas .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}))
  }, text)

/** A fresh empty paragraph after "Start here." with the caret in it (one transaction, as Barkdown's probe). */
const startParagraph = async (page: Page) => {
  await page.evaluate(() => {
    const ed = (document.querySelector('bp-paper-canvas') as unknown as {_editor: Ed})._editor
    let at: number | null = null
    ed.state.doc.forEach((n, offset) => void (n.type.name === 'paragraph' && n.textContent.includes('Start here') && (at = offset + n.nodeSize)))
    ed.chain().focus().insertContentAt(at!, {type: 'paragraph'}).setTextSelection(at! + 1).run()
  })
  // Typing goes in only once the editor has focus and the caret sits in that empty paragraph.
  await page.waitForFunction(() => {
    const ed = (document.querySelector('bp-paper-canvas') as unknown as {_editor: Ed & {view: {hasFocus(): boolean}}})._editor
    const s = ed.state.selection as unknown as {empty: boolean; $from: {depth: number; parent: {type: {name: string}; textContent: string}}}
    return ed.view.hasFocus() && s.empty && s.$from.depth === 1 && s.$from.parent.type.name === 'paragraph' && !s.$from.parent.textContent
  })
}

/** The caret at the end of the i-th body cell (-1: the last), placed when a click leaves a whole-cell selection. */
const caretInCell = async (page: Page, i: number) => {
  const cells = page.locator('bp-paper-canvas .bp-table__td')
  const n = await cells.count()
  const k = i < 0 ? n + i : i
  await cells.nth(k).click()
  await page.evaluate((k) => {
    const ed = (document.querySelector('bp-paper-canvas') as unknown as {_editor: Ed})._editor
    const found: {pos: number; size: number}[] = []
    ed.state.doc.descendants((node, pos) => void (node.type.name === 'bpTableCell' && found.push({pos, size: node.nodeSize})))
    const cell = found[k]!
    ed.commands.setTextSelection(cell.pos + cell.size - 1)
    ed.commands.focus()
  }, k)
}

/** The table chrome lives in a "Configure table" disclosure: open it, then the button. */
const chrome = async (page: Page, name: string) => {
  const d = page.locator('bp-paper-canvas details:has(summary:has-text("Configure table"))').first()
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator('summary').click()
  return page.locator(`bp-paper-canvas [aria-label*="${name}" i]`).first()
}

test('@local D15: tables — slash insert, Tab/Shift+Tab, Tab adds a row, add/remove rows and columns, undo, GFM paste, Enter in a cell, reload', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  test.setTimeout(120_000)
  await t.prepare(context)
  await page.goto(t.docPath('paper', ID))
  await t.settle(page)
  const pm = page.locator('bp-paper-canvas .ProseMirror')
  await expect(pm).toBeVisible({timeout: 20_000})
  const status = page.locator('.pd-status')
  // A fresh open settles first (the doc's own live refresh can land a moment after).
  await expect(status).toHaveText('Saved', {timeout: 15_000})
  await page.waitForTimeout(500)
  const agree = async () => {
    await expect(status).toHaveText('Saved', {timeout: 15_000})
    const canvas = await grids(page)
    await expect.poll(() => serverGrids(t), {timeout: 10_000}).toEqual(canvas)
    return canvas
  }

  // /table: a table with a header row.
  await startParagraph(page)
  await page.keyboard.type('/table')
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await grids(page)).length).toBe(1)
  expect((await grids(page))[0]![0]!.every((c) => c.startsWith('#'))).toBe(true)
  // Settle as Barkdown's probe does: the new table is node-selected for a moment, and a
  // click that lands before it lays out leaves that selection (typing would replace it).
  await page.waitForTimeout(600)

  // Type; Tab and Shift+Tab move between cells and select them (typing replaces).
  await pm.locator('.bp-table__th').first().click()
  await page.keyboard.type('Name')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Qty')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Apple')
  await page.keyboard.press('Tab')
  await page.keyboard.type('3')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.type('Pear')
  await expect.poll(async () => (await grids(page))[0]).toEqual([['#Name', '#Qty'], ['Pear', '3']])
  await agree()

  // Tab in the last cell adds a row.
  await caretInCell(page, -1)
  await page.keyboard.press('Tab')
  await expect.poll(async () => (await grids(page))[0]!.length).toBe(3)
  await page.keyboard.type('Plum')
  expect((await agree())[0]![2]![0]).toBe('Plum')

  // The chrome: add a column and a row, then remove them.
  await caretInCell(page, 0)
  await (await chrome(page, 'add column')).click()
  await (await chrome(page, 'add row')).click()
  await expect.poll(async () => (await grids(page))[0]!.every((r) => r.length === 3)).toBe(true)
  expect((await agree())[0]!.length).toBe(4)
  await caretInCell(page, 0)
  await (await chrome(page, 'remove column')).click()
  await (await chrome(page, 'remove row')).click()
  await expect.poll(async () => (await grids(page))[0]!.every((r) => r.length === 2)).toBe(true)
  await agree()

  // Undo a cell edit; the server follows.
  await caretInCell(page, 0)
  await page.keyboard.type('XYZ')
  await agree()
  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(async () => JSON.stringify(await grids(page))).not.toContain('XYZ')
  await agree()

  // A pasted GFM pipe table becomes a table block.
  await startParagraph(page)
  await paste(page, '| City | Pop |\n|---|---|\n| Oslo | 700k |\n| Bergen | 290k |')
  await expect.poll(async () => (await grids(page)).find((g) => g[0]?.[0] === '#City')).toEqual([['#City', '#Pop'], ['Oslo', '700k'], ['Bergen', '290k']])
  await agree()

  // Enter inside a cell does not split the table.
  const before = await grids(page)
  const tables = (await kinds(page)).filter((k) => k === 'bpTable').length
  await caretInCell(page, 0)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  expect((await kinds(page)).filter((k) => k === 'bpTable').length).toBe(tables)
  expect((await grids(page)).map((g) => g.length)).toEqual(before.map((g) => g.length))
  const shown = await agree()

  // Reload: the tables come back from the server as edited.
  await page.reload()
  await t.settle(page)
  await expect(pm).toBeVisible({timeout: 20_000})
  await expect.poll(() => grids(page), {timeout: 10_000}).toEqual(shown)
  await page.screenshot({path: 'evidence/D15-studio.png'})
})
