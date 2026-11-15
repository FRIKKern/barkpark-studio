import {expect, test} from '../rig/test'
import {BACKEND_POLL, closeAndSettle, signInIfAsked, target} from '../rig/targets'

// J33 array power tools, as Sanity's: a long array folds after 4 items ("Show all N items"); the
// nested item dialog's sidebar tree finds an item in another section and opens it, breadcrumbs
// in step, in the Published view too (read-only there); the six-type insert menu searches as you
// type, filters by tab and shows a grid. Looking writes nothing. On fieldTypes
// (fixtures/barkpark-schema/fieldTypes.json): a dataset whose fieldTypes has no insertMenu yet
// (the CI pool until reseeded with --schemas) skips the insert menu, the last part.
const ID = `fieldTypes-arraytools-${Date.now().toString(36)}`
const sections = Array.from({length: 6}, (_, i) => ({_key: `s${i}`, title: `Section ${i + 1}`, items: [1, 2].map((j) => ({_key: `s${i}i${j}`, label: `Item ${i + 1}.${j}`}))}))

test.beforeEach(({}, info) => test.skip(target(info).name === 'sanity', "ours: Sanity's is the reference"))
test.afterEach(async ({page}, info) => (await closeAndSettle(page), await target(info).deleteDoc(ID, 'fieldTypes')))

test('J33 arrays: Show all N items; the dialog tree opens a nested item, read-only in Published, and writes nothing; the insert menu filters, tabs and grids', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(ID, 'fieldTypes', {title: 'Array tools', sections}), t.prepare(page.context())])
  await page.goto(t.docPath('fieldTypes', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const field = (n: string) => page.locator(`[id="${n}"]`).locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " field ")][1]')

  // Folded after 4, as Sanity's; Show all draws the rest.
  await expect(page.locator('#sections .array-row')).toHaveCount(4)
  await field('sections').getByRole('button', {name: 'Show all 6 items'}).click()
  await expect(page.locator('#sections .array-row')).toHaveCount(6)
  await expect(field('sections').getByRole('button', {name: 'Show fewer items'})).toHaveAttribute('aria-expanded', 'true')

  // The tree: from Section 2's dialog to Item 5.2, two levels down in another section.
  await field('sections').getByRole('button', {name: 'Section 2', exact: true}).click()
  const dialog = page.getByRole('dialog', {name: /^Sections \//})
  const toggle = dialog.getByRole('button', {name: /sidebar/})
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(dialog.getByRole('treeitem', {name: /Section 2/})).toHaveAttribute('aria-selected', 'true')
  await dialog.getByRole('searchbox', {name: 'Search items'}).fill('5.2')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog').last().getByRole('navigation', {name: 'Breadcrumb'})).toHaveText(/^Sections\s*\/\s*#5 Section 5\s*\/\s*Items\s*\/\s*#2 Item 5\.2$/)
  await expect(page.getByRole('dialog')).toHaveCount(2)
  await expect.poll(() => decodeURIComponent(page.url())).toContain('path=sections[_key=="s4"].items[_key=="s4i2"]')
  // Nothing was written by looking.
  await expect.poll(() => t.docValue(ID, 'sections', 'fieldTypes'), BACKEND_POLL).toEqual(sections)

  // The Published view: the tree still finds an item, and its dialog (drawn outside the form's
  // disabled fieldset) is read-only too: on main typing there wrote a draft.
  await t.restore(ID, {title: 'Array tools'}, 'fieldTypes')
  await page.goto(`${t.docPath('fieldTypes', ID)},path=${encodeURIComponent('sections[_key=="s0"]')}?perspective=published`)
  await t.settle(page)
  const shown = page.getByRole('dialog').last()
  if ((await shown.getByRole('button', {name: /sidebar/}).getAttribute('aria-expanded')) !== 'true') await shown.getByRole('button', {name: /sidebar/}).click()
  await shown.getByRole('searchbox', {name: 'Search items'}).fill('6.1')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog').last().getByRole('navigation', {name: 'Breadcrumb'})).toHaveText(/#6 Section 6\s*\/\s*Items\s*\/\s*#1 Item 6\.1$/)
  await expect(page.getByRole('dialog').last().getByRole('textbox', {name: 'Label'})).toBeDisabled()
  expect((await t.versions(ID)).draft).toBeUndefined()

  // The insert menu, last: it needs fixtures/barkpark-schema's insertMenu on the dataset.
  await page.goto(t.docPath('fieldTypes', ID))
  await t.settle(page)
  await field('blocks').getByRole('button', {name: 'Add item...'}).click()
  const grid = page.getByRole('menuitemcheckbox', {name: 'Toggle grid view'})
  test.skip(!(await grid.isVisible()), "this dataset's fieldTypes schema has no insertMenu yet (reseed with --schemas)")
  await page.keyboard.type('fa')
  await expect(page.getByRole('menuitem')).toHaveText(['FAQ'])
  await page.getByRole('searchbox', {name: 'Search', exact: true}).fill('')
  await page.getByRole('menuitemradio', {name: 'Marketing'}).click()
  await expect(page.getByRole('menuitem')).toHaveText(['Call to action', 'Stat', 'Logo strip'])
  await grid.click()
  await expect(page.locator('.insert-grid [role=menuitem]')).toHaveCount(3)
  await page.locator('.insert-grid [role=menuitem]').first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.insert-grid [role=menuitem]').nth(1)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  expect(await t.docValue(ID, 'blocks', 'fieldTypes')).toBeUndefined()
})
