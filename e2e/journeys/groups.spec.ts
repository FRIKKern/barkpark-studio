import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// Sanity's visibleGroups: post's Promotion group holds only promoLine, hidden until featured,
// so its tab is gone until Featured is on.
test('J30: a group whose fields are all hidden has no tab until one shows', async ({page}, info) => {
  const t = target(info)
  const id = `post-promo-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'Promo probe', slug: {_type: 'slug', current: id}, featured: false})
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', id))
    await t.settle(page)
    await expect(page.getByRole('tab', {name: 'Meta'})).toBeVisible()
    await expect(page.getByRole('tab', {name: 'Promotion'})).toHaveCount(0)
    await page.getByRole('tab', {name: 'Meta'}).click()
    await t.field(page, 'featured').click()
    await expect(page.getByRole('tab', {name: 'Promotion'})).toBeVisible()
  } finally {
    await t.deleteDoc(id, 'post')
  }
})
