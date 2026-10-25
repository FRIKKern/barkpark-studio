import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// B09, ours: the author schema's desk.views ({id: posts, type: post, by: author, title
// order}) opens as a view of the author: the posts that name them, in that order. What
// can break silently: the view disappears, lists other posts, or loses its order.
test('@local B09: an author\'s "Posts" view lists the posts by them, by title', async ({page}, info) => {
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

// J18, both studios: a nested list of the studio's own structure (Sanity's S.list() under an
// S.listItem(), reference/sanity/structure.ts): its own rows, each with its icon, its titled
// divider, and a filtered type list under it. Ours used to show the first pane again.
test('@local J18: a nested structure list opens its own rows, and a filtered list under it', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto('/structure/editorial')
  await signInIfAsked(page)
  await t.settle(page)
  const menu = page.getByLabel('Editorial', {exact: true})
  const rows = menu.getByRole('link')
  await expect(rows).toHaveText(['Featured posts', 'Top rated', 'Category'])
  await expect(menu.getByText('Taxonomy', {exact: true})).toBeVisible()
  // Each row: its icon (FolderIcon, none being named) and the chevron.
  for (const row of await rows.all()) await expect(row.locator('svg')).toHaveCount(2)
  if (t.name === 'studio') await expect(page.locator('[data-pane="types"] .type-row', {hasText: 'Editorial'})).toHaveAttribute('aria-current', 'true')
  await rows.filter({hasText: 'Featured posts'}).click()
  const titles = page.locator('a[href*="featured-posts;post-"]').filter({hasText: 'Fixture post'})
  await expect(titles).toHaveCount(6)
  // Every fifth post is featured (fixtures/seed.ndjson).
  expect((await titles.allInnerTexts()).map((s) => s.split('\n')[0]!.trim()).sort()).toEqual(['05', '10', '15', '20', '25', '30'].map((n) => `Fixture post ${n}`))
})
