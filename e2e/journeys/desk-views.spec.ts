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
