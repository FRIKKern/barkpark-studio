import {expect, test} from '../rig/test'
import {BACKEND_POLL, closeAndSettle, signInIfAsked, target} from '../rig/targets'

// J33 array power tools, as Sanity's: a long array folds after 4 items ("Show all N items"); the
// nested item dialog's sidebar tree finds an item in another section and opens it, breadcrumbs
// in step, in the Published view too, where nothing writes (a dialog, a paste, a body canvas);
// the six-type insert menu searches as you type, filters by tab and shows a grid. Looking
// writes nothing. On fieldTypes
// (fixtures/barkpark-schema/fieldTypes.json): a dataset whose fieldTypes has no insertMenu yet
// (the CI pool until reseeded with --schemas) skips the insert menu, the last part.
const ID = `fieldTypes-arraytools-${Date.now().toString(36)}`
const POST = `post-arraytools-${Date.now().toString(36)}`
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})
const sections = Array.from({length: 6}, (_, i) => ({_key: `s${i}`, title: `Section ${i + 1}`, items: [1, 2].map((j) => ({_key: `s${i}i${j}`, label: `Item ${i + 1}.${j}`}))}))

test.beforeEach(({}, info) => test.skip(target(info).name === 'sanity', "ours: Sanity's is the reference"))
test.afterEach(async ({page}, info) => (await closeAndSettle(page), await Promise.all([target(info).deleteDoc(ID, 'fieldTypes'), target(info).deleteDoc(POST, 'post')])))

test('J33 arrays: Show all N items; the dialog tree opens a nested item; the Published view writes nothing (dialog, paste, body); the insert menu filters, tabs and grids', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(ID, 'fieldTypes', {title: 'Array tools', sections}), t.draftOnly(POST, 'post', {title: 'Array tools body'}), t.prepare(page.context()), page.context().grantPermissions(['clipboard-read', 'clipboard-write'])])
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

  // Read-only views write nothing, however they are reached (lib/form-lock.ts). First a copied
  // `sections` field (Cmd/Ctrl+C on its Show fewer toggle), then a published version unlike it.
  await page.goto(t.docPath('fieldTypes', ID))
  await t.settle(page)
  await field('sections').getByRole('button', {name: 'Show fewer items'}).focus()
  await page.keyboard.press('ControlOrMeta+c')
  const published = sections.map((s, i) => (i ? s : {...s, title: 'Section 1, published'}))
  await Promise.all([t.restore(ID, {title: 'Array tools', sections: published}, 'fieldTypes'), t.restore(POST, {title: 'Array tools body', body: {blocks: [para('p1', 'Published words.')]}}, 'post')])
  // 1. Paste on "Show all" (a focusable span in the disabled form): refused.
  await page.goto(`${t.docPath('fieldTypes', ID)}?perspective=published`)
  await t.settle(page)
  await field('sections').getByRole('button', {name: 'Show all 6 items'}).focus()
  await page.keyboard.press('ControlOrMeta+v')
  // 2. The item dialog (drawn outside the form's fieldset): the tree still finds an item; read-only.
  await page.goto(`${t.docPath('fieldTypes', ID)},path=${encodeURIComponent('sections[_key=="s0"]')}?perspective=published`)
  await t.settle(page)
  const shown = page.getByRole('dialog').last()
  if ((await shown.getByRole('button', {name: /sidebar/}).getAttribute('aria-expanded')) !== 'true') await shown.getByRole('button', {name: /sidebar/}).click()
  await shown.getByRole('searchbox', {name: 'Search items'}).fill('6.1')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog').last().getByRole('navigation', {name: 'Breadcrumb'})).toHaveText(/#6 Section 6\s*\/\s*Items\s*\/\s*#1 Item 6\.1$/)
  await expect(page.getByRole('dialog').last().getByRole('textbox', {name: 'Label'})).toBeDisabled()
  // 3. A post's body canvas: a click doesn't wake it to edit; typing goes nowhere.
  await page.goto(`${t.docPath('post', POST)}?perspective=published`)
  await t.settle(page)
  await page.locator('[id="body"]').click()
  await page.keyboard.type(' xyz')
  await expect(page.locator('[id="body"]')).toHaveAttribute('aria-readonly', 'true')
  await expect(page.locator('[id="body"] [contenteditable="true"]')).toHaveCount(0)
  await page.waitForFunction(() => !(window as unknown as {__savesPending: () => boolean}).__savesPending())
  expect([(await t.versions(ID)).draft, (await t.versions(POST)).draft]).toEqual([undefined, undefined])

  // The insert menu, last: it needs fixtures/barkpark-schema's insertMenu on the dataset.
  await page.goto(t.docPath('fieldTypes', ID))
  await t.settle(page)
  await field('blocks').getByRole('button', {name: 'Add item...'}).click()
  // The menu drawn first (its search, past five types), so a missing grid toggle means no insertMenu.
  await expect(page.getByRole('menu').getByRole('searchbox', {name: 'Search', exact: true})).toBeVisible()
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
