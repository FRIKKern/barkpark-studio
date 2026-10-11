import {expect, test} from '@playwright/test'
import {closeAndSettle, target} from '../rig/targets'

// J34: tags typed at full speed, Enter after each, all land in order (a fast second Enter
// built on the list before the first add and dropped it: J13 re-recording, 2026-10-11).
const ID = 'post-20'
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).resetDoc(ID, 'post')))

// @local: the end-to-end check (about 3.3 s); CI's guard is lib/pending-list.test.ts.
test('@local J34: tags typed fast with Enter all land, in order', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  await t.field(page, 'tags').click()
  for (const tag of ['one', 'two', 'three', 'four']) (await page.keyboard.type(tag), await page.keyboard.press('Enter'))
  const all = ['fixture', 't0', 'one', 'two', 'three', 'four']
  // On screen at once (the lost tag never showed as a chip), then on the server.
  if (t.name === 'studio') await expect.poll(() => page.locator('.tags-box .tag').allInnerTexts()).toEqual(all)
  await expect.poll(() => t.docValue(ID, 'tags'), {timeout: 10_000}).toEqual(all)
})
