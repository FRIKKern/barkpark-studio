import {expect, test} from '@playwright/test'
import {closeAndSettle, target} from '../rig/targets'

// J34: tags typed at full speed, Enter after each, all land in order (a fast second Enter
// built on the list before the first add and dropped it: J13 re-recording, 2026-10-11).
const ID = 'post-20'
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).resetDoc(ID, 'post')))

// @local: 3–11 s locally (the server catching up with four writes), over rule 5's 5 s.
test('@local J34: tags typed fast with Enter all land, in order', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  await t.field(page, 'tags').click()
  for (const tag of ['one', 'two', 'three', 'four']) (await page.keyboard.type(tag), await page.keyboard.press('Enter'))
  await expect.poll(() => t.docValue(ID, 'tags'), {timeout: 10_000}).toEqual(['fixture', 't0', 'one', 'two', 'three', 'four'])
})
