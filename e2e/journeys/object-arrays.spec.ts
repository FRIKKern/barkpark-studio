import {expect, test, type Page} from '@playwright/test'
import {target, type Target} from '../rig/targets'

// J33 evidence, both studios, on post-03's links (an external link and a doc
// link): preview rows; open an item, edit it in the dialog; add an item; move it
// to the top by keyboard. Stills + clips go to e2e/evidence/. Not a CI gate.
// The links go back to what they were after the run, on both sides. Sanity's "Add item…" menu
// of several types has no Barkpark equivalent yet (task-b3ebbd3ab1575e2a).
const ID = 'post-03'
const shot = (name: string, step: string) => `evidence/J33-${name}-${step}.png`
test.use({video: 'on'})

const linksField = (t: Target, page: Page) =>
  t.name === 'sanity' ? page.locator('[data-testid="field-links"]') : page.locator('.field').filter({has: page.locator('[id="links"]')}).last()
const titles = async (t: Target, page: Page) =>
  ((await t.docValue(ID, 'links')) as {title?: string}[] | undefined)?.map((l) => l.title) ?? []

let original: unknown
test.afterEach(async ({}, info) => target(info).restore(ID, {title: 'Fixture post 03', ...(original !== undefined && {links: original})}))

test('@evidence J33: object array — previews, edit in a dialog, add, reorder', async ({page}, info) => {
  const t = target(info)
  original = await t.docValue(ID, 'links')
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

  // Add an item: Sanity asks which type; ours has one (Barkpark arrayOf).
  await links.getByRole('button', {name: /Add item/}).click()
  if (t.name === 'sanity') await page.getByRole('menuitem', {name: 'External Link'}).click()
  const added = page.getByRole('dialog').last()
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
