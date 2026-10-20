import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// The three probes' docs are written at once, while the first test's browser starts, and
// removed together after (each test wrote and removed its own in turn).
const stamp = Date.now().toString(36)
const NESTED = `post-nested-${stamp}`
const GROUP = `post-group-jump-${stamp}`
const FIELDSET = `ft-fieldset-jump-${stamp}`
let seeded: Promise<unknown>
test.beforeAll(({}, info) => {
  const t = target(info)
  seeded = Promise.all([
    t.draftOnly(NESTED, 'post', {title: 'Nested probe', slug: {_type: 'slug', current: NESTED}, links: [{_key: 'l1', kind: 'externalLink', title: 'Bad link', url: 'not a url'}]}),
    t.draftOnly(GROUP, 'post', {title: 'Group jump', slug: {_type: 'slug', current: GROUP}, rating: 9}),
    t.draftOnly(FIELDSET, 'fieldTypes', {title: 'Fieldset jump', handle: {_type: 'slug', current: FIELDSET}, limit: 50}),
  ])
  seeded.catch(() => {}) // a test that awaits it says so
})
test.afterAll(({}, info) => {
  const t = target(info)
  return Promise.all([t.deleteDoc(NESTED, 'post'), t.deleteDoc(GROUP, 'post'), t.deleteDoc(FIELDSET, 'fieldTypes')])
})

// J13, nested, as Sanity's: a bad value in an array item is a validation error named
// "Links / External link / URL", and picking it in the panel opens that item and puts
// the caret in its field. (The item's fields went unchecked before.)
test('@local J13: an array item field error is listed and jumped to', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's panel is the scout's still")
  await Promise.all([seeded, t.prepare(page.context())])
  await page.goto(t.docPath('post', NESTED))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('button', {name: 'Validation'}).first().click()
  const panel = page.getByRole('complementary', {name: 'Validation'})
  const entry = panel.getByRole('button').filter({hasText: 'Not a valid URL'})
  await expect(entry).toContainText('Links / External link / URL')
  await entry.click()
  await expect(page.locator('[id=\'links[_key=="l1"].url\']')).toBeFocused()
  await expect(page.locator('[id=\'links[_key=="l1"].url\']')).toHaveValue('not a url')
})

// Sanity's jump selects the field's own group: from Content, a Meta field's error opens Meta (not All fields).
test("@local J13: picking an error in another group selects that field's group", async ({page}, info) => {
  const t = target(info)
  await Promise.all([seeded, t.prepare(page.context())])
  await page.goto(t.docPath('post', GROUP))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(page.getByRole('tab', {name: 'Content'})).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', {name: 'Validation'}).first().click()
  await page.getByText('Must be lower than or equal to 5').last().click()
  await expect(page.getByRole('tab', {name: 'Meta'})).toHaveAttribute('aria-selected', 'true')
  await expect(t.field(page, 'rating')).toBeFocused()
})

// Sanity's jump opens a folded fieldset on the way: fieldTypes' More starts collapsed, with Limit (max 10) in it.
test('@local J13: picking an error in a collapsed fieldset opens it', async ({page}, info) => {
  const t = target(info)
  await Promise.all([seeded, t.prepare(page.context())])
  await page.goto(t.docPath('fieldTypes', FIELDSET))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(t.field(page, 'limit')).toBeHidden()
  await page.getByRole('button', {name: 'Validation'}).first().click()
  await page.getByText('Must be lower than or equal to 10').last().click()
  await expect(t.field(page, 'limit')).toBeFocused()
})
