import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// J08, the picker's order for a typed search, as Sanity's: best matches first, then by
// title with numbers in order (it read "Fixture post 30, 28, 15…", newest first).
test('J08: reference search lists "Fixture post" in title order', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's order is the scout's")
  const id = `post-reforder-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'Ref order probe', slug: {_type: 'slug', current: id}})
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('tab', {name: 'Meta'}).click()
    const combo = page.locator('[id="related"][role="combobox"]')
    await combo.fill('Fixture post 0')
    const options = page.locator(`[id="${await combo.getAttribute('aria-controls')}"] [role="option"]`)
    await expect(options.first()).toContainText('Fixture post 01')
    await expect(options.nth(1)).toContainText('Fixture post 02')
    await expect(options.nth(2)).toContainText('Fixture post 03')
    // Every field and the preview's author, as global search: "lovelace" finds Ada's posts.
    await combo.fill('lovelace')
    await expect(options.first()).toContainText('Ada Lovelace')
    await expect(options.filter({hasText: 'Fixture post 03'})).toHaveCount(1)
  } finally {
    await t.deleteDoc(id, 'post')
  }
})
