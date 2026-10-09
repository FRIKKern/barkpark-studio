import {expect, test, type Page} from '@playwright/test'
import {resetNative, target} from '../rig/targets'

// D17, Barkdown's EDITOR-PARITY row 12 (its slash sweep, editor-opaque.live.mjs) on our
// canvas: the blocks the slash menu offers insert as editable blocks (never a read-only
// bpOpaque chip) and land on the server. The row's own list, plus the quote Barkdown's
// sweep caught. A one-off sweep of all 45 items (2026-10-09) found 43 land; Terminal and
// Stage insert nothing, a canvas gap (task-d170de40027ea448), so they are not here.
const ID = 'paper-04'
const TYPES = [
  // slash item → the server block it makes
  ['code', 'code'],
  ['divider', 'divider'],
  ['expandable', 'expandable'],
  ['steps', 'steps'],
  ['tabs', 'tabs'],
  ['equation', 'equation'],
  ['video', 'video'],
  ['blockquote', 'blockquote'],
  ['callout', 'callout'],
] as const
test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio') await resetNative(ID, 'paper')
})

type Ed = {
  getJSON(): {content: {type: string; attrs?: {bpType?: string}}[]}
  state: {doc: {forEach(f: (n: {type: {name: string}; textContent: string; nodeSize: number}, offset: number) => void): void}; selection: unknown}
  chain(): {focus(): {insertContentAt(p: number, c: unknown): {setTextSelection(p: number): {run(): void}}}}
  view: {hasFocus(): boolean}
}

/** A fresh empty paragraph after "Start here." with the caret in it (as D15). */
const startParagraph = async (page: Page) => {
  await page.evaluate(() => {
    const ed = (document.querySelector('bp-paper-canvas') as unknown as {_editor: Ed})._editor
    let at: number | null = null
    ed.state.doc.forEach((n, offset) => void (n.type.name === 'paragraph' && n.textContent.includes('Start here') && (at = offset + n.nodeSize)))
    ed.chain().focus().insertContentAt(at!, {type: 'paragraph'}).setTextSelection(at! + 1).run()
  })
  await page.waitForFunction(() => {
    const ed = (document.querySelector('bp-paper-canvas') as unknown as {_editor: Ed})._editor
    const s = ed.state.selection as {empty: boolean; $from: {depth: number; parent: {type: {name: string}; textContent: string}}}
    return ed.view.hasFocus() && s.empty && s.$from.depth === 1 && s.$from.parent.type.name === 'paragraph' && !s.$from.parent.textContent
  })
}

test('@local D17: the slash menu\'s blocks insert editable and save', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  await page.goto(t.docPath('paper', ID))
  await t.settle(page)
  await expect(page.locator('bp-paper-canvas')).toContainText('Start here.', {timeout: 20_000})
  const serverTypes = async () => ((await t.docValue(ID, 'blocks', 'paper')) as {type: string}[]).map((b) => b.type)

  for (const [item, type] of TYPES) {
    await startParagraph(page)
    await page.keyboard.type('/')
    await page.locator(`body .bp-slash-menu [role=option][data-type="${item}"]`).first().click()
    await expect.poll(serverTypes, {message: `/${item} lands as a ${type} block`, timeout: 10_000}).toContain(type)
    // Let the canvas settle its post-insert selection before the next pick (as D15).
    await page.waitForTimeout(300)
  }
  const kinds = await page.evaluate(() => (document.querySelector('bp-paper-canvas') as unknown as {_editor: Ed})._editor.getJSON().content.map((n) => n.attrs?.bpType ?? n.type))
  for (const [, type] of TYPES) expect(kinds, `${type} is in the canvas`).toContain(type)
  await expect(page.locator('bp-paper-canvas [data-type="bpOpaque"], bp-paper-canvas .bp-opaque')).toHaveCount(0)
  await expect(page.locator('.pd-status')).toHaveText('Saved')
  await expect(page.locator('.pd-conflict')).toHaveCount(0)
  await page.screenshot({path: 'evidence/D17-studio.png', fullPage: true})
})
