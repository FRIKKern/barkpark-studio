import {expect, test} from '../rig/test'
import {target} from '../rig/targets'

// Barkpark-native track, as LiveView's paper header: the document menu's "Open standalone"
// opens Barkpark's reader for the paper (/w/<workspace>/p/<project>/papers/<slug>) in a new tab.
test('@local B: a paper opens standalone in Barkpark’s reader from the document menu', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native')
  await t.prepare(context)
  await page.goto(t.docPath('paper', 'paper-01'))
  await t.settle(page)
  await page.getByRole('button', {name: 'Show document actions'}).click()
  const [reader] = await Promise.all([context.waitForEvent('page'), page.getByRole('menuitem', {name: 'Open standalone'}).click()])
  expect(reader.url()).toBe(`${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/papers/paper-01`)
  await reader.close()
})
