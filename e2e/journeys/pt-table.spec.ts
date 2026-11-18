import {expect, test} from '../rig/test'
import {bpBase, bpDataset, bpMutate, closeAndSettle, savesLanded, target} from '../rig/targets'

// Tables in a Portable Text field (J11): Insert puts in Sanity's table (three by three, a
// header row), the caret in its first cell; Tab moves to the next cell; the lane under the
// table adds a row; each lands as it is done and holds over a reload. The table the text
// already held (it is why Insert offers one even where a dataset's schema does not declare
// `table` yet) is not touched: it goes back as it was stored. A scratch doc, removed after.
const ID = `post-pt-table-${Date.now().toString(36)}`
const block = (key: string, text: string) => ({_key: key, _type: 'block', style: 'normal', markDefs: [], children: [{_key: `${key}s`, _type: 'span', marks: [], text}]})
const HELD = {_key: 'held', _type: 'table', headerRows: 1, rows: [{_key: 'heldr', _type: 'row', cells: [{_key: 'heldc', _type: 'cell', value: [block('heldb', 'Kept as stored')]}]}]}
const BODY = [block('p1', 'Before'), block('p2', 'After'), HELD]

type Cell = {_key: string; _type: string; value: {_key: string; children: {text: string}[]}[]}
type Table = {_key: string; _type: string; headerRows?: number; rows: {_key: string; _type: string; cells: Cell[]}[]}
const stored = async (): Promise<(Table | {_type: 'block'})[] | undefined> => {
  const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/post/${ID}?perspective=drafts`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  return r.ok ? ((await r.json()) as {result: {ptBody?: (Table | {_type: 'block'})[]}}).result.ptBody : undefined
}
const texts = (t: Table | undefined) => t?.rows.map((r) => r.cells.map((c) => c.value.map((b) => b.children.map((s) => s.text).join('')).join('/')))

test.beforeEach(async ({}, info) => {
  test.skip(target(info).name !== 'studio', 'ours: Sanity edits its own table; the desk has no Portable Text input')
  await bpMutate([{createOrReplace: {_id: ID, _type: 'post', title: 'Table notes', ptBody: BODY}}])
})
test.afterEach(async ({page}) => (await closeAndSettle(page), await bpMutate([{delete: {id: ID, type: 'post', force: true}}]).catch(() => {})))

test('J11: a table inserted in a Portable Text field takes typing cell by cell with Tab, a new row, and holds over a reload', async ({page}, info) => {
  const t = target(info)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'All fields'}).click()
  const field = page.locator('.pt-input').filter({has: page.locator('[id="ptBody"]')})
  await field.and(page.locator('[data-ready]')).waitFor()
  const editor = page.locator('[id="ptBody"]')
  // The held table draws as a grid, not a card.
  await expect(editor.locator('table')).toHaveCount(1)
  await editor.getByText('Before', {exact: true}).click()
  await field.getByRole('button', {name: 'Insert Table (block)'}).click()
  const table = editor.locator('table').first()
  await expect(table.locator('tr')).toHaveCount(3)
  // The caret is in the new table's first cell: the keys go there, Tab to the next cell.
  await expect.poll(() => page.evaluate(() => !!getSelection()?.focusNode?.parentElement?.closest('td'))).toBe(true)
  await page.keyboard.type('Tea')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Minutes')
  await expect(table.locator('td').nth(1)).toHaveText('Minutes')
  // The lane under the last row adds a row at the end (Sanity's "Add row at end").
  await table.locator('tr').last().locator('td').first().hover()
  await page.locator('.pt-plugin-table-chrome').first().getByRole('button', {name: 'Add row at end'}).click()
  await expect(table.locator('tr')).toHaveCount(4)
  await savesLanded(page)

  // The body as the poll last read it: the checks below look at that read, not two more.
  let body: Awaited<ReturnType<typeof stored>>
  const landed = () => body?.filter((b): b is Table => b._type === 'table')
  await expect.poll(async () => ((body = await stored()), texts(landed()?.[0])), {timeout: 10_000}).toEqual([['Tea', 'Minutes', ''], ['', '', ''], ['', '', ''], ['', '', '']])
  const [made, held] = landed()!
  // Sanity's shape: a header row, rows of cells of blocks, each with its own 12-hex key.
  expect(made!.headerRows).toBe(1)
  const keys = [made!, ...made!.rows, ...made!.rows.flatMap((r) => r.cells), ...made!.rows.flatMap((r) => r.cells.flatMap((c) => c.value))].map((n) => n._key)
  expect(keys.filter((k) => !/^[0-9a-f]{12}$/.test(k))).toEqual([])
  expect(new Set(keys).size).toBe(keys.length)
  expect(made!.rows.every((r) => r._type === 'row' && r.cells.every((c) => c._type === 'cell'))).toBe(true)
  // The table the text held, and the text around it, went back as stored.
  expect(held).toEqual(HELD)
  expect(body!.map((b) => b._type)).toEqual(['block', 'table', 'block', 'table'])

  await page.reload()
  await t.settle(page)
  await page.locator('.pt-input[data-ready]').filter({has: page.locator('[id="ptBody"]')}).waitFor()
  const again = page.locator('[id="ptBody"] table').first()
  await expect(again.locator('tr')).toHaveCount(4)
  await expect(again.locator('td').first()).toHaveText('Tea')
  await expect(again.locator('td').nth(1)).toHaveText('Minutes')
})
