import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J11 guard (a CI gate): in the inline body field a block's "Block options" button shows
// on hover and opens the block menu (Duplicate, Move, Delete). #285 hid it with the
// gutter and only @evidence J11 noticed. Nothing is written: the menu closes unpicked.
test('J11: a body block offers Block options inline, outside its text', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Barkpark's canvas: Sanity's block menu is on the block itself")
  await page.goto(t.docPath('post', 'post-01'))
  await signInIfAsked(page)
  await t.settle(page)
  const field = page.locator('.body-canvas')
  await field.getByText('Body paragraph for post 1.').click()
  await expect(field.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
  const block = field.locator('bp-paper-canvas [role="group"]').first()
  await block.hover()
  const options = page.getByRole('button', {name: 'Block options'}).first()
  await expect(options).toBeVisible()
  // Left of the frame, never over the text (the steady frame keeps its 12 px inset).
  const [frame, button] = [await field.boundingBox(), await options.boundingBox()]
  expect(button!.x + button!.width, 'left of the frame').toBeLessThanOrEqual(frame!.x + 12)
  await options.click()
  await expect(page.locator('.bp-block-menu__item').filter({hasText: 'Duplicate'})).toBeVisible()
  await page.keyboard.press('Escape')
})
