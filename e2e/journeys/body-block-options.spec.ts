import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// J11 guard (a CI gate), as Sanity's inline body: a text block shows no gutter, and a block
// object (here the callout) offers its menu at its own right edge. From Barkpark canvas
// 1.12.0 the callout is Sanity's block object card, whose own "…" offers Edit and Remove
// (lead's call, 2026-10-17, task-e4d09605e39ef6be); an older canvas moves the block
// handle there (Duplicate, Move, Delete). Either way Duplicate stays reachable from the
// expanded body's gutter. Nothing is written: every menu closes unpicked.
test('@local J11: inline, a block object offers its menu at its right edge; text shows no gutter', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Barkpark's canvas: Sanity's block menu is on the block itself")
  await page.goto(t.docPath('post', 'post-01'))
  await signInIfAsked(page)
  await t.settle(page)
  const field = page.locator('.body-canvas')
  await field.getByText('Body paragraph for post 1.').click()
  await expect(field.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
  const options = page.getByRole('button', {name: 'Block options'}).first()
  await field.getByText('Body paragraph for post 1.').hover()
  await expect(options).toBeHidden()
  const callout = field.locator('bp-paper-canvas [role="group"]').first()
  await callout.hover()
  const own = callout.getByRole('button', {name: 'Open menu'})
  const button = (await own.isVisible()) ? own : options
  await expect(button).toBeVisible()
  // Inside the frame, at the right (Sanity's "…" on the object), never over the text start.
  const [frame, box] = [await field.boundingBox(), await button.boundingBox()]
  expect(box!.x, 'right half of the frame').toBeGreaterThan(frame!.x + frame!.width / 2)
  expect(box!.x + box!.width, 'inside the frame').toBeLessThanOrEqual(frame!.x + frame!.width)
  await button.click()
  if (button === own) {
    await expect(options, 'one "…" on the card, never the block handle beside it').toBeHidden()
    await expect(page.locator('.bp-canvas-object-menu [role="menuitem"]')).toHaveText(['Edit', 'Remove'])
  } else await expect(page.locator('.bp-block-menu__item').filter({hasText: 'Duplicate'})).toBeVisible()
  await page.keyboard.press('Escape')
  // Expanded, the gutter's block handle still duplicates and moves a block.
  await page.getByRole('button', {name: /Expand editor/}).first().click()
  await field.getByText('Body paragraph for post 1.').hover()
  await expect(options).toBeVisible()
  await options.click()
  await expect(page.locator('.bp-block-menu__item').filter({hasText: 'Duplicate'})).toBeVisible()
  await page.keyboard.press('Escape')
})
