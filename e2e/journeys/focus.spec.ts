import {expect, test, type Locator, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target} from '../rig/targets'

// J43 evidence, both studios: dialogs keep Tab inside, and every dialog and
// menu hands focus back to its opener when it closes (F13). Covers the
// document "…" menu, Inspect, Delete and an array item's dialog. Where focus
// lands is written to the test's annotations, so the two sides can be read
// next to each other. Stills go to e2e/evidence/. Not a CI gate.
const ID = 'post-03'
const shot = (name: string, step: string) => `evidence/J43-${name}-${step}.png`

// What has focus, in words: tag, role and name.
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return 'body'
    const name = el.getAttribute('aria-label') || el.id || el.textContent?.trim().slice(0, 40) || ''
    return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''} "${name}"`
  })
const inside = (box: Locator) => box.evaluate((el) => el.contains(document.activeElement))

// Tab (or Shift+Tab) enough times to wrap round. Returns where focus left the
// dialog, if it ever did: ours must never; Sanity's is recorded, not judged.
async function tabEscapes(page: Page, dialog: Locator, presses = 12) {
  const out: string[] = []
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab')
    if (!(await dialog.count())) return [...out, `#${i + 1} closed it (focus on ${await focused(page)})`]
    if (!(await inside(dialog))) out.push(`#${i + 1} ${await focused(page)}`)
  }
  return out
}

async function openMenu(t: Target, page: Page, button: Locator) {
  const id = t.name === 'sanity' ? await button.getAttribute('id') : null
  await button.focus()
  await page.keyboard.press('Enter')
  if (!id) return page.getByRole('menu')
  await page.waitForTimeout(300) // its menu animates in
  return page.locator(`[role=menu][aria-labelledby="${id}"]`)
}

test.use({video: 'on'})

test('@evidence J43: dialogs trap focus; focus returns to the opener', async ({page}, info) => {
  const t = target(info)
  const note = (what: string, where: string) => info.annotations.push({type: what, description: where})
  const trapped = async (what: string, dialog: Locator) => {
    const escapes = await tabEscapes(page, dialog)
    note(`${what}: Tab left it`, escapes.join(', ') || 'never')
    if (t.name === 'studio') expect(escapes).toEqual([])
  }
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)

  // The "…" menu, keyboard only: arrows move, Escape closes, focus is back on "…".
  const dots = t.docMenu(page)
  let menu = await openMenu(t, page, dots)
  await expect(menu.getByRole('menuitem').first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  note('menu: after ArrowDown', await focused(page))
  expect(await inside(menu)).toBe(true)
  await page.screenshot({path: shot(t.name, '1-menu')})
  await page.keyboard.press('Escape')
  await expect(menu.getByRole('menuitem').first()).toBeHidden()
  note('menu: after Escape', await focused(page))
  await expect(dots).toBeFocused()

  // Inspect, from the title: Tab stays in, Escape returns to the title.
  await t.field(page, 'title').click()
  await page.keyboard.press('Control+Alt+i')
  const inspect = page.getByRole('dialog').filter({hasText: 'Inspecting'})
  await expect(inspect).toBeVisible()
  await trapped('inspect', inspect)
  await page.screenshot({path: shot(t.name, '2-inspect')})
  await page.keyboard.press('Escape')
  await expect(inspect).toHaveCount(0)
  note('inspect: after Escape', await focused(page))
  // Sanity drops focus to <body> here (measured 2026-10-06); ours goes back to the title.
  if (t.name === 'studio') await expect(t.field(page, 'title')).toBeFocused()

  // Delete, from the "…" menu: Tab stays in; Escape cancels; focus is not lost.
  menu = await openMenu(t, page, dots)
  await menu.getByRole('menuitem', {name: 'Delete'}).click()
  const del = page.getByRole('dialog').filter({hasText: /Delete/})
  await expect(del).toBeVisible()
  note('delete: on open', await focused(page))
  await trapped('delete', del)
  await page.screenshot({path: shot(t.name, '3-delete')})
  await page.keyboard.press('Escape')
  await expect(del).toHaveCount(0)
  note('delete: after Escape', await focused(page))
  if (t.name === 'studio') await expect(dots).toBeFocused()

  // An array item's dialog: Tab stays in; Escape returns to the row that opened it.
  await page.getByRole('tab', {name: 'Meta'}).click()
  const links = t.name === 'sanity' ? page.locator('[data-testid="field-links"]') : page.locator('.field').filter({has: page.locator('[id="links"]')}).last()
  const row = links.getByRole('button', {name: /Sanity docs/}).first()
  await row.scrollIntoViewIfNeeded()
  await expect(row).toBeVisible()
  await row.click()
  const item = page.getByRole('dialog').last()
  await expect(item.getByRole('textbox', {name: 'Title'})).toBeVisible()
  if (t.name === 'sanity') await page.waitForTimeout(600) // its dialog animates in, then takes focus
  note('item: on open', await focused(page))
  await page.screenshot({path: shot(t.name, '4-item')})
  await trapped('item', item)
  await page.keyboard.press('Escape')
  await expect(item.getByRole('textbox', {name: 'Title'})).toHaveCount(0)
  note('item: after Escape', await focused(page))
  if (t.name === 'studio') await expect(row).toBeFocused()
})

// The CI lock (F13): the "…" menu and the Delete dialog it opens. Sanity
// passes this too.
test('J43: menu → dialog keeps focus inside, returns it to "…"', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const dots = t.docMenu(page)
  const menu = await openMenu(t, page, dots)
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dots).toBeFocused()

  await (await openMenu(t, page, dots)).getByRole('menuitem', {name: 'Delete'}).click()
  const del = page.getByRole('dialog').filter({hasText: /Delete/})
  await expect(del).toBeVisible()
  expect(await tabEscapes(page, del, 6)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(del).toHaveCount(0)
  await expect(dots).toBeFocused()
})
