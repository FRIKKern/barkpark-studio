import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// The Dashboard tool (Sanity's @sanity/dashboard, which the reference Studio does not
// install): the studio config's widgets show their rows, an edit made by another client
// comes into Recently edited live (once), and a row opens its document in Structure through
// the edit intent. What breaks silently here: a widget's read, the frame-to-row path (no
// read behind it to notice), the row's link.
test('dashboard: widgets show their rows, an edit from outside comes in live, a row opens its document in Structure', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the reference Studio has no dashboard plugin, and the desk no dashboard")
  const ID = 'post-19'
  const draft = `dash-${Date.now().toString(36)}`
  const title = `Dashboard ${draft}`
  await t.prepare(page.context())
  // A document that is only a draft: Unpublished changes has it, whatever else the dataset holds.
  await t.draftOnly(draft, 'post', {title: `Draft ${draft}`, slug: {_type: 'slug', current: draft}})
  try {
    await page.goto('/dashboard')
    await signInIfAsked(page)
    await expect(page).toHaveTitle(/^Dashboard · /)
    await expect(page.getByRole('navigation').getByRole('link', {name: 'Dashboard'})).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1)
    const region = (name: string | RegExp) => page.getByRole('region', {name})
    const recent = region('Recently edited')
    await expect(recent.getByTestId('dash-doc').first()).toBeVisible()
    await expect(region('Unpublished changes').getByTestId('dash-doc').filter({hasText: `Draft ${draft}`})).toHaveCount(1)
    // Sanity's document list from the config (five posts, a Create new) and the config's own widget.
    await expect(region('Latest posts').getByTestId('dash-doc')).toHaveCount(5)
    await expect(region('Latest posts').getByRole('link', {name: 'Create new Post'})).toBeVisible()
    await expect(region('House style')).toContainText('Headlines in sentence case')
    // Shared sign-in (the e2e default) has no "me": the tasks widget says what it lists.
    for (const name of [/^(My|Open) tasks$/, 'Scheduled', 'Members']) await expect(region(name)).toBeVisible()
    await page.waitForTimeout(500) // stream open
    // Another client edits and publishes a post: its row is first, there once, with no reload.
    await t.patch(ID, {title})
    await expect(recent.getByTestId('dash-doc').first()).toContainText(title)
    await expect(recent.getByTestId('dash-doc').filter({hasText: title})).toHaveCount(1)
    await recent.getByTestId('dash-doc').first().click()
    await expect(page).toHaveURL(new RegExp(`/structure/post;${ID}$`))
    await expect(t.field(page, 'title')).toHaveValue(title)
  } finally {
    await t.restore(ID, {title: 'Fixture post 19'})
    await t.deleteDoc(draft, 'post')
  }
})
