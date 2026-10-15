import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J13, nested, as Sanity's: a bad value in an array item is a validation error named
// "Links / External link / URL", and picking it in the panel opens that item and puts
// the caret in its field. (The item's fields went unchecked before.)
test('J13: an array item field error is listed and jumped to', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's panel is the scout's still")
  const id = `post-nested-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'Nested probe', slug: {_type: 'slug', current: id}, links: [{_key: 'l1', kind: 'externalLink', title: 'Bad link', url: 'not a url'}]})
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('button', {name: 'Validation'}).first().click()
    const panel = page.getByRole('complementary', {name: 'Validation'})
    const entry = panel.getByRole('button').filter({hasText: 'Not a valid URL'})
    await expect(entry).toContainText('Links / External link / URL')
    await entry.click()
    await expect(page.locator('[id=\'links[_key=="l1"].url\']')).toBeFocused()
    await expect(page.locator('[id=\'links[_key=="l1"].url\']')).toHaveValue('not a url')
  } finally {
    await t.deleteDoc(id, 'post')
  }
})
