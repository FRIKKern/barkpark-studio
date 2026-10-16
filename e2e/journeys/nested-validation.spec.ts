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

// Sanity's jump selects the field's own group: from Content, a Meta field's error opens Meta (not All fields).
test("J13: picking an error in another group selects that field's group", async ({page}, info) => {
  const t = target(info)
  const id = `post-group-jump-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'Group jump', slug: {_type: 'slug', current: id}, rating: 9})
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await expect(page.getByRole('tab', {name: 'Content'})).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', {name: 'Validation'}).first().click()
    await page.getByText('Must be lower than or equal to 5').last().click()
    await expect(page.getByRole('tab', {name: 'Meta'})).toHaveAttribute('aria-selected', 'true')
    await expect(t.field(page, 'rating')).toBeFocused()
  } finally {
    await t.deleteDoc(id, 'post')
  }
})

// Sanity's jump opens a folded fieldset on the way: fieldTypes' More starts collapsed, with Limit (max 10) in it.
test('J13: picking an error in a collapsed fieldset opens it', async ({page}, info) => {
  const t = target(info)
  const id = `ft-fieldset-jump-${Date.now().toString(36)}`
  await t.draftOnly(id, 'fieldTypes', {title: 'Fieldset jump', handle: {_type: 'slug', current: id}, limit: 50})
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('fieldTypes', id))
    await signInIfAsked(page)
    await t.settle(page)
    await expect(t.field(page, 'limit')).toBeHidden()
    await page.getByRole('button', {name: 'Validation'}).first().click()
    await page.getByText('Must be lower than or equal to 10').last().click()
    await expect(t.field(page, 'limit')).toBeFocused()
  } finally {
    await t.deleteDoc(id, 'fieldTypes')
  }
})
