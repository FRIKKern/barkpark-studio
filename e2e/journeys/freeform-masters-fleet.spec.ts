import {expect, test, type Page} from '@playwright/test'
import {bpBase, bpDataset, closeAndSettle, resetNative, target} from '../rig/targets'

// D13 and D14, ours (Barkpark-only: Sanity has no Freeform). What can break silently: a
// paper's task blocks stop painting or stop following a task change; a block can no
// longer be saved as a master, inserted linked, pinned or detached.
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const canvas = (page: Page) => page.locator('bp-paper-canvas')

test('D14: a paper\'s task block shows its tasks and follows a change live', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  const task = `task-d14-1-${bpDataset()}`
  await page.goto(t.docPath('paper', 'paper-01'))
  await t.settle(page)
  const hole = canvas(page).locator('[data-bp-fleet-id="tl1"] [data-bp-fleet-body]')
  await expect(hole).toContainText('Write the D14 note', {timeout: 15_000})
  await expect(hole).toContainText('Wire the previews')
  try {
    await t.restore(task, {title: 'Write the D14 note, renamed'}, 'task')
    await expect(hole).toContainText('Write the D14 note, renamed', {timeout: 10_000})
  } finally {
    await t.restore(task, {title: 'Write the D14 note'}, 'task')
  }
})

test.describe('D13', () => {
  const ID = 'paper-03'
  const masters = async () => ((await (await fetch(`${bpBase()}/v1/papers/${ID}/masters?dataset=${bpDataset()}`, {headers: auth()})).json()) as {masters: {docId: string; title: string}[]}).masters
  test.afterEach(async ({page}, info) => {
    await closeAndSettle(page)
    if (target(info).name !== 'studio') return
    for (const m of await masters().catch(() => [])) await target(info).deleteDoc(m.docId, 'paper_master')
    await resetNative(ID, 'paper')
  })

  test('D13: save a block as a master, insert it linked, pin, unpin, detach', async ({page}, info) => {
    const t = target(info)
    test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
    await page.goto(t.docPath('paper', ID))
    await t.settle(page)
    await expect(canvas(page)).toContainText('Start here.', {timeout: 20_000})
    // Save: the block menu's "Save as master" on the paragraph.
    await canvas(page).getByText('Start here.').hover()
    await page.locator('.bp-block-handle__grip').click()
    await page.locator('.bp-block-menu [data-action="save-master"]').click()
    await expect(page.getByText('Saved as master')).toBeVisible({timeout: 10_000})
    await expect.poll(async () => (await masters()).length, {timeout: 10_000}).toBe(1)
    // Insert linked: "/" then the master's linked row, at the end.
    await page.evaluate(() => {
      type N = {type: {name: string}; textContent: string; nodeSize: number}
      const ed = (document.querySelector('bp-paper-canvas') as unknown as {_editor: {state: {doc: {forEach(f: (n: N, o: number) => void): void}}; chain(): {focus(): {insertContentAt(p: number, c: unknown): {setTextSelection(p: number): {run(): void}}}}}})._editor
      let at = 0
      ed.state.doc.forEach((n, o) => void (n.textContent.includes('Start here') && (at = o + n.nodeSize)))
      ed.chain().focus().insertContentAt(at, {type: 'paragraph'}).setTextSelection(at + 1).run()
    })
    await page.waitForFunction(() => {
      const ed = (document.querySelector('bp-paper-canvas') as unknown as {_editor: {view: {hasFocus(): boolean}; state: {selection: {empty: boolean; $from: {depth: number; parent: {type: {name: string}; textContent: string}}}}}})._editor
      const s = ed.state.selection
      return ed.view.hasFocus() && s.empty && s.$from.depth === 1 && s.$from.parent.type.name === 'paragraph' && !s.$from.parent.textContent
    })
    await page.keyboard.type('/')
    await page.locator('body .bp-slash-menu [role=option][data-type="master-linked"]').first().click()
    const linked = page.getByTestId('linked-master')
    await expect(linked).toHaveCount(1, {timeout: 10_000})
    const blockTypes = async () => ((await t.docValue(ID, 'blocks', 'paper')) as {type: string; version?: unknown; master?: {mode?: string}}[])
    await expect.poll(async () => (await blockTypes()).filter((b) => b.type === 'master-ref').length).toBe(1)
    // Pin, then unpin: the server block carries a version only while pinned.
    await linked.getByRole('button', {name: 'Pin'}).click()
    await expect(linked.getByRole('button', {name: 'Unpin'})).toBeVisible({timeout: 10_000})
    await expect.poll(async () => (await blockTypes()).find((b) => b.type === 'master-ref')?.version != null).toBe(true)
    await linked.getByRole('button', {name: 'Unpin'}).click()
    await expect(linked.getByRole('button', {name: 'Pin'})).toBeVisible({timeout: 10_000})
    // Detach: the linked block becomes a plain copy, marked detached.
    await linked.getByRole('button', {name: 'Detach'}).click()
    await expect(linked).toHaveCount(0, {timeout: 10_000})
    await expect.poll(async () => (await blockTypes()).filter((b) => b.type === 'master-ref').length).toBe(0)
    await expect.poll(async () => (await blockTypes()).filter((b) => b.master?.mode === 'detached' && JSON.stringify(b).includes('Start here.')).length).toBe(1)
    await expect(canvas(page).getByText('Start here.')).toHaveCount(2)
  })
})
