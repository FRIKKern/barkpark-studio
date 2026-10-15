import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J33, Sanity's Duplicate on an object item: the copy is added after it and opens in its
// dialog ("Links / #2 …"), ready to change.
test('J33: Duplicate on an object item opens the copy', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's is the scout's still")
  const id = `post-dup-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'Duplicate probe', slug: {_type: 'slug', current: id}, links: [{_key: 'l1', kind: 'externalLink', title: 'Sanity docs', url: 'https://www.sanity.io/docs'}]})
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('tab', {name: 'Meta'}).click()
    await page.locator('[id=\'links[_key=="l1"]-menuButton\']').click()
    await page.getByRole('menuitem', {name: 'Duplicate'}).click()
    const dialog = page.getByRole('dialog', {name: /^Links \/ /})
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', {name: 'Title'})).toHaveValue('Sanity docs')
  } finally {
    await t.deleteDoc(id, 'post')
  }
})
