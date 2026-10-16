import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// B09, ours: the author schema's desk.views ({id: posts, type: post, by: author, title
// order}) opens as a view of the author: the posts that name them, in that order. What
// can break silently: the view disappears, lists other posts, or loses its order.
test('B09: an author\'s "Posts" view lists the posts by them, by title', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "Barkpark-native: Sanity's equivalent is a structure view")
  await page.goto(t.docPath('author', 'author-ada'))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Posts'}).click()
  const titles = page.locator('a[href*="post-"]').filter({hasText: 'Fixture post'})
  await expect(titles.first()).toBeVisible({timeout: 10_000})
  const got = (await titles.allInnerTexts()).map((s) => s.split('\n')[0]!.trim())
  // Ada is the author of posts 03, 06, 09, 12, … 30 (every third).
  const want = ['03', '06', '09', '12', '15', '18', '21', '24', '27', '30'].map((n) => `Fixture post ${n}`)
  expect(got.filter((x) => /^Fixture post \d\d$/.test(x))).toEqual(want)
})

// J18: a nested list of the studio's own structure (Sanity's S.list() under an S.listItem(),
// reference/sanity/structure.ts): its own rows, icons and titled divider, its row marked in
// the first pane, and a filtered type list under it. It used to show the first pane again.
test('J18: a nested structure list opens its own rows, and a filtered list under it', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'the reference shows it once its studio reloads the structure')
  await page.goto('/structure/editorial')
  await signInIfAsked(page)
  await t.settle(page)
  const menu = page.locator('[data-pane="menu:editorial"]')
  await expect(menu.locator('.type-row')).toHaveText(['Featured posts', 'Top rated', 'Category'])
  await expect(menu.locator('.desk-divider')).toHaveText('Taxonomy')
  await expect(menu.locator('.type-row .desk-icon')).toHaveCount(3)
  await expect(page.locator('[data-pane="types"] .type-row', {hasText: 'Editorial'})).toHaveAttribute('aria-current', 'true')
  await menu.getByText('Featured posts').click()
  const titles = page.locator('[data-pane-index="2"] a[href*="post-"]').filter({hasText: 'Fixture post'})
  await expect(titles).toHaveCount(6)
  // Every fifth post is featured (fixtures/seed.ndjson).
  expect((await titles.allInnerTexts()).map((s) => s.split('\n')[0]!.trim()).sort()).toEqual(['05', '10', '15', '20', '25', '30'].map((n) => `Fixture post ${n}`))
})
