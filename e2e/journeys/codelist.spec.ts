import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// B05, ours: a codelist field picks a code by searching. What can break silently: the
// tree stops finding codes, a pick does not save, a flat code loses its label.
test('B05: codelist fields — the Thema tree finds and picks a code by search; the flat code shows its label', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only type')
  await page.goto(t.docPath('volume', 'volume-01'))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Main'}).click()
  const audience = page.locator('.field').filter({hasText: 'Audience'}).first()
  await expect(audience).toBeVisible()
  await expect(audience).not.toContainText('Not in the list')
  const tree = page.locator('.codelist-tree-field')
  await expect(tree.locator('.codelist-current')).toContainText('FBA')
  try {
    await tree.getByPlaceholder('Search codes or labels…').fill('YFB')
    const item = tree.getByRole('treeitem').filter({hasText: 'YFB'}).first()
    await expect(item).toBeVisible({timeout: 5_000})
    await item.click()
    await expect(tree.locator('.codelist-current')).toContainText('YFB')
    await expect.poll(() => t.docValue('volume-01', 'subject', 'volume'), {timeout: 10_000}).toBe('YFB')
  } finally {
    await t.restore('volume-01', {subject: 'FBA'}, 'volume')
  }
})
