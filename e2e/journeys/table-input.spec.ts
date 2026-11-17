import {expect, test} from '../rig/test'
import {bpMutate, closeAndSettle, savesLanded, signInIfAsked, target} from '../rig/targets'

// The table field (Sanity's @sanity/table): `{_type: 'table', rows: [{_type: 'tableRow',
// _key, cells: string[]}]}` edited as a grid. What can break silently: a column put in
// before the caret's cell, and the first keys typed over the cell that stood there (its
// text selected, gone); a block pasted from a spreadsheet stops filling and growing the
// grid; the stored shape drifts from Sanity's. Its own scratch document, so no fixture is
// edited. Two editors in one table: lib/table-input.test.ts.
//
// It runs in CI on a PR that changes the fixture schemas (the studio reads them from the
// checkout) and on a dataset seeded with them; on a dataset whose fieldTypes schema has no
// `sizeChart` yet (the CI pool until it is reseeded with --schemas) it skips.
const ID = `e2e-table-${Date.now().toString(36)}`
const row = (key: string, ...cells: string[]) => ({_type: 'tableRow', _key: key, cells})

test('a table field: a column put in left of the caret takes the keys typed next, a block pasted from a spreadsheet fills and grows the grid, stored in Sanity\'s shape', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the reference studio has no table plugin installed')
  await bpMutate([{createOrReplace: {_id: ID, _type: 'fieldTypes', title: 'Table scratch', sizeChart: {_type: 'table', rows: [row('a', 'Size', 'Chest'), row('b', 'S', '88')]}}}])
  try {
    await page.goto(t.docPath('fieldTypes', ID))
    await signInIfAsked(page)
    await t.settle(page)
    await page.locator('[id="title"]').waitFor()
    const table = page.locator('[id="sizeChart"]')
    test.skip((await table.count()) === 0, "this dataset's fieldTypes schema has no sizeChart field yet (fixtures/barkpark-schema/fieldTypes.json; reseed with --schemas)")
    const cell = (r: number, c: number) => table.getByRole('textbox', {name: `Row ${r}, column ${c}`, exact: true})
    await expect(cell(1, 1)).toHaveValue('Size')

    // The keys typed right after the menu go to the new column's cell; "Size" moves right, whole.
    await table.getByRole('button', {name: 'Column 1', exact: true}).click()
    await page.getByRole('menuitem', {name: 'Insert column left'}).click()
    await page.keyboard.type('Fit')
    await expect(cell(1, 1)).toHaveValue('Fit')
    await expect(cell(1, 2)).toHaveValue('Size')

    // Two rows of two cells copied from a spreadsheet, pasted on "88": one column and one row more.
    await cell(2, 3).click()
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/plain', '90 cm\t72 cm\r\n96 cm\t80 cm\r\n')
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}))
    })
    await expect(cell(3, 4)).toHaveValue('80 cm')
    await savesLanded(page)
    const stored = () => t.docValue(ID, 'sizeChart', 'fieldTypes') as Promise<{_type: string; rows: {_type: string; _key: string; cells: string[]}[]} | undefined>
    await expect.poll(async () => (await stored())?.rows.map((r) => r.cells), {timeout: 10_000}).toEqual([['Fit', 'Size', 'Chest', ''], ['', 'S', '90 cm', '72 cm'], ['', '', '96 cm', '80 cm']])
    // Sanity's shape to the letter: the table's type, each row a keyed tableRow, the old keys kept.
    const value = (await stored())!
    expect(value._type).toBe('table')
    expect(value.rows.map((r) => [r._type, Object.keys(r).sort().join()])).toEqual(Array(3).fill(['tableRow', '_key,_type,cells']))
    expect(value.rows.slice(0, 2).map((r) => r._key)).toEqual(['a', 'b'])
  } finally {
    await closeAndSettle(page)
    await bpMutate([{delete: {id: ID, type: 'fieldTypes', force: true}}]).catch(() => {})
  }
})
