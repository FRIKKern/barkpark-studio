import {expect, test} from '@playwright/test'
import {installProbes, timeToReady} from '../rig/feel'
import {target} from '../rig/targets'

// J18, both studios: new post from the list, initial values, slug Generate.
let created: string | undefined
test.afterEach(async ({}, info) => {
  if (created) await target(info).deleteDoc(created, 'post')
  created = undefined
})

test('J18: new post from the list — initial values, slug generate', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.prepare(page.context()), installProbes(page.context())])
  await page.goto(t.listPath('post'))
  await t.settle(page)

  const opened = await timeToReady(page, t.newDocButton(t.pane(page, 1)), `() => !!document.querySelector('[data-pane-index="2"] [id="title"]')`, null)
  created = decodeURIComponent(page.url()).match(/;([0-9a-f-]{36})/)?.[1]
  expect(created, 'new doc id in the URL').toBeTruthy()
  if (t.name === 'studio') expect(opened.ms, 'F2 new doc pane').toBeLessThan(100)

  await t.field(page, 'title').click()
  await page.keyboard.type('My brand new post')
  await page.getByRole('button', {name: 'Generate'}).click()
  await expect(t.field(page, 'slug')).toHaveValue('my-brand-new-post')

  // It exists now, with the type's initial value and what was typed.
  await expect.poll(() => t.docValue(created!, 'slug').then((s) => (typeof s === 'object' && s ? (s as {current: string}).current : s)), {timeout: 10_000}).toBe('my-brand-new-post')
  expect(await t.docValue(created!, 'featured')).toBe(false)
})
