import AxeBuilder from '@axe-core/playwright'
import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// A phone (390, touch), light: the list search's icon sits on its words' line (the phone and
// touch rules once stacked into an icon above them), and the History panel passes axe.
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, colorScheme: 'light'})
test('@local 390 touch: list search icon on its line; History passes axe', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours')
  await t.prepare(page.context())
  await page.goto(t.listPath('post'))
  await t.settle(page)
  const box = await page.locator('.pane.list > .search input').boundingBox()
  const icon = await page.locator('.pane.list > .search .search-icon').boundingBox()
  expect(Math.abs(icon!.y + icon!.height / 2 - (box!.y + box!.height / 2)), 'icon centred on the field').toBeLessThan(2)
  // Under 600 px the menu has no History, as Sanity's: a link still opens it.
  await page.goto(`${t.docPath('post', 'post-01')},changesInspectorTab=history,inspect=sanity/structure/history`)
  await t.settle(page)
  await expect(page.getByRole('list', {name: 'Document revisions'})).toBeVisible()
  const {violations} = await new AxeBuilder({page}).include('.history-list').withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(violations.map((v) => v.id)).toEqual([])
})
