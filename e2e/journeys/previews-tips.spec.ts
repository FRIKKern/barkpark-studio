import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J56 and J57, ours (their side by side is the evidence stills; the owner signs off).
// What can break silently: a reference's title stops showing as a list subtitle or in
// a reference field, an empty title loses its fallback, the status tooltips lose their
// dates; an icon button loses its tooltip or its shortcut; a repeated toast stacks.
const tooltip = (page: Page) => page.getByRole('tooltip')

test('J56: previews — reference subtitle, untitled fallback, status tooltips with dates', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'the check runs on ours')
  await t.draftOnly('post-untitled-j56', 'post', {excerpt: 'No title here.'})
  try {
    await page.goto('/structure/post')
    await signInIfAsked(page)
    await t.settle(page)
    const row = page.locator('a[href*="post-01"]').first()
    await expect(row).toContainText('Fixture post 01')
    await expect(row).toContainText('Alan Turing') // the referenced author's title as subtitle
    await expect(page.locator('a[href*="post-untitled-j56"]').first()).toContainText('Untitled')
    await row.getByTestId('row-status').hover()
    await expect(tooltip(page)).toContainText(/Published\s*Published (?:\d|a |an |just|yesterday)/)
    await expect(tooltip(page)).toContainText(/No unpublished edits|Edited/)
    // The open doc: its reference field shows the title, the header chip a date.
    await row.click()
    await expect(page.locator('.field').filter({hasText: 'Author'}).first()).toContainText('Alan Turing')
    await page.getByRole('button', {name: 'Published', exact: true}).hover()
    await expect(tooltip(page)).toContainText(/Published \w{3} \d{1,2}, \d{4}/)
  } finally {
    await t.deleteDoc('post-untitled-j56', 'post')
  }
})

test('J57: every icon button has a tooltip, shortcuts show; a repeated toast replaces itself and closes', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'the check runs on ours')
  await page.goto(t.docPath('post', 'post-01'))
  await signInIfAsked(page)
  await t.settle(page)
  // The navbar's and the document header's icon buttons, and each field's "…", Add comment
  // and drag handle (Sanity's "Field actions", "Add comment", "Drag to re-order"); those
  // show on hover, so they count shown or not. Not the avatar: Sanity's has no tooltip.
  await page.getByRole('tab', {name: 'All fields'}).click().catch(() => {})
  const buttons = page.locator('.navbar .icon-btn:visible:not(.user-btn), .pane-header .icon-btn:visible, .field .icon-btn[aria-label="Field actions"], .field .comment-add, .field .drag-handle')
  const total = await buttons.count()
  expect(total).toBeGreaterThan(3)
  expect(await page.locator('.field .drag-handle').count(), 'an array with a drag handle is in view').toBeGreaterThan(0)
  const untipped = await buttons.evaluateAll((els) => els.filter((e) => !e.getAttribute('data-tip') && !e.closest('[data-tip]')).map((e) => e.getAttribute('aria-label') ?? e.outerHTML.slice(0, 80)))
  expect(untipped, 'icon buttons without a tooltip').toEqual([])
  // One shown on hover, with the search's shortcut.
  await page.locator('[data-tip-keys]').first().hover()
  await expect(tooltip(page)).toContainText(/Search/)
  await expect(tooltip(page).locator('kbd')).toContainText([/Ctrl|Cmd/, 'K'])
  await page.mouse.move(0, 0)
  // Ctrl/Cmd+S twice: one "saved" toast, not two; Close takes it down.
  await page.keyboard.press('ControlOrMeta+s')
  await page.keyboard.press('ControlOrMeta+s')
  const toasts = page.getByText('Your work is automatically saved!')
  await expect(toasts).toHaveCount(1)
  await page.locator('.toast-close').first().click()
  await expect(toasts).toHaveCount(0)
})
