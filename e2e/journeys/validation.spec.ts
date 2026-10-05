import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// J13, both studios: rules from the schema, checked as you type; publish blocked
// until they pass; the Validation panel lists them.
const ID = 'post-19'

test.afterEach(async ({}, info) => target(info).resetDoc(ID, 'post'))

test('J13: inline errors, publish blocked, validation panel', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const publish = page.getByRole('button', {name: /^Publish$/}).last()

  // Required title, emptied.
  await t.field(page, 'title').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect(publish).toBeDisabled()

  // Rating over its max (Meta group).
  await page.getByRole('tab', {name: 'Meta'}).click()
  await t.field(page, 'rating').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('9')

  await page.getByRole('button', {name: 'Validation'}).click()
  const panel = page.getByText('Must be lower than or equal to 5').filter({visible: true}).first()
  await expect(panel).toBeVisible()
  await expect(page.getByText('Required', {exact: true}).filter({visible: true}).first()).toBeVisible()

  // Fix both: publish comes back.
  await page.keyboard.press('ControlOrMeta+a')
  await t.field(page, 'rating').fill('3')
  await page.getByRole('tab', {name: 'Content'}).click()
  await t.field(page, 'title').fill('Fixture post 19 fixed')
  await expect(publish).toBeEnabled({timeout: 10_000})
  // Ours coalesces writes: let the last land before the reset.
  if (t.name === 'studio') await page.getByText(/^Saved$/).waitFor()
})
