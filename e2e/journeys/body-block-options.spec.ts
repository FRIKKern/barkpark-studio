import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J11 guard (a CI gate), as Sanity's inline body: a text block shows no gutter, a block
// object (here the callout) offers its menu at its own right edge, and that menu has
// Duplicate, Move and Delete. #285 hid the menu with the gutter and only @evidence J11
// noticed. Nothing is written: the menu closes unpicked.
test('J11: inline, a block object offers its menu at its right edge; text shows no gutter', async ({page}, info) => {
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
  await field.locator('bp-paper-canvas [role="group"]').first().hover()
  await expect(options).toBeVisible()
  // Inside the frame, at the right (Sanity's "…" on the object), never over the text start.
  const [frame, button] = [await field.boundingBox(), await options.boundingBox()]
  expect(button!.x, 'right half of the frame').toBeGreaterThan(frame!.x + frame!.width / 2)
  expect(button!.x + button!.width, 'inside the frame').toBeLessThanOrEqual(frame!.x + frame!.width)
  await options.click()
  await expect(page.locator('.bp-block-menu__item').filter({hasText: 'Duplicate'})).toBeVisible()
  await page.keyboard.press('Escape')
})
