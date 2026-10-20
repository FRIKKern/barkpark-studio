import {expect, test, type Page} from '@playwright/test'
import {closeAndSettle, target, type Target} from '../rig/targets'

// J33 evidence, both studios, on post-03's links (an external link and a doc
// link): preview rows; open an item, edit it in the dialog; add an item; move it
// to the top by keyboard. Stills + clips go to e2e/evidence/. Not a CI gate.
// The post goes back to the seed after the run, on both sides. Ours reads the types
// from the member's options until Barkpark's arrayOf holds several (task-b3ebbd3ab1575e2a).
const ID = 'post-03'
const shot = (name: string, step: string) => `evidence/J33-${name}-${step}.png`
test.use({video: 'on'})

const linksField = (t: Target, page: Page) =>
  t.name === 'sanity' ? page.locator('[data-testid="field-links"]') : page.locator('.field').filter({has: page.locator('[id="links"]')}).last()
const titles = async (t: Target, page: Page) =>
  ((await t.docValue(ID, 'links')) as {title?: string}[] | undefined)?.map((l) => l.title) ?? []

// The seed's post back after every run, on both sides (a failed run must not leave the next one dirty).
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).resetDoc(ID, 'post')))

test('@evidence J33: object array — previews, edit in a dialog, add, reorder', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  const links = linksField(t, page)
  await links.scrollIntoViewIfNeeded()
  await expect(links.getByRole('button', {name: /Sanity docs/})).toBeVisible()
  await expect(links).toContainText('Fixture post 04') // the doc link's preview names its target
  await links.screenshot({path: shot(t.name, '1-rows')})

  // Open the external link; edit its title in the dialog.
  await links.getByRole('button', {name: /Sanity docs/}).click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toContainText('Links')
  await page.screenshot({path: shot(t.name, '2-dialog')})
  const title = dialog.getByRole('textbox', {name: 'Title'})
  await title.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Sanity docs v2')
  await dialog.getByRole('button', {name: 'Close dialog'}).click()
  await expect(links.getByRole('button', {name: /Sanity docs v2/})).toBeVisible()
  await expect.poll(() => titles(t, page), {timeout: 10_000}).toEqual(['Sanity docs v2', 'Related post'])

  // Add an item: both ask which type, and the new item shows that type's fields only.
  await links.getByRole('button', {name: /Add item/}).click()
  await page.getByRole('menuitem', {name: 'External link'}).click()
  const added = page.getByRole('dialog').last()
  await expect(added.getByRole('textbox', {name: 'URL'})).toBeVisible()
  await expect(added.getByText('Target', {exact: true})).toHaveCount(0)
  await added.getByRole('textbox', {name: 'Title'}).fill('Barkpark')
  await page.waitForTimeout(t.name === 'sanity' ? 800 : 300)
  await page.screenshot({path: shot(t.name, '3-new-item')})
  await added.getByRole('button', {name: 'Close dialog'}).click()
  await expect.poll(() => titles(t, page), {timeout: 10_000}).toEqual(['Sanity docs v2', 'Related post', 'Barkpark'])

  // Keyboard: pick up the new last row, two up, drop.
  const press = async (key: string) => (await page.keyboard.press(key), t.name === 'sanity' && (await page.waitForTimeout(200)))
  await links.locator('button[aria-roledescription="sortable"]').last().focus()
  for (const key of ['Space', 'ArrowUp', 'ArrowUp', 'Space']) await press(key)
  await expect.poll(() => titles(t, page), {timeout: 10_000}).toEqual(['Barkpark', 'Sanity docs v2', 'Related post'])
  await links.screenshot({path: shot(t.name, '4-reordered')})
})
