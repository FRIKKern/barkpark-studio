import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// J10, F8 (nothing lost): the body is read-only until a click wakes Barkpark's canvas,
// which takes a moment on a fresh page (its bundle, the blocks). Keys typed in that
// moment used to vanish; now they are kept and typed in once the canvas has the caret.
const ID = 'post-29'
let before: unknown
test.afterEach(async ({}, info) => {
  if (before !== undefined) await target(info).restore(ID, {body: before})
  before = undefined
})

test('J10: keys typed while the body wakes up are all kept', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the wake-up is our read-only body')
  await t.prepare(page.context())
  before = await t.docValue(ID, 'body')
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const body = page.locator('[id="body"]')
  await body.scrollIntoViewIfNeeded()
  await body.click()
  await page.keyboard.type('XYZZY', {delay: 20}) // at once, before the canvas is up
  await expect(body.locator('.ProseMirror')).toContainText('XYZZY', {timeout: 15_000})
  await expect.poll(async () => JSON.stringify(await t.docValue(ID, 'body')), {timeout: 15_000}).toContain('XYZZY')
})
