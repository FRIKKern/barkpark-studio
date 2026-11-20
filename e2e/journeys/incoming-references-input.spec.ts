import {expect, test} from '../rig/test'
import {bpMutate, closeAndSettle, signInIfAsked, target} from '../rig/targets'

// J17, ours: Sanity's incoming references input (defineIncomingReferenceDecoration). The
// author form lists the posts that name the author (app/src/studio.config.tsx:
// form.incomingReferences; needs no schema change, so it runs on main's CI too); a row opens the
// post in the next pane; "Add item" creates a post whose author is this author, listed at
// once. What can break silently: the list is gone or lists other authors' posts, the new
// post points nowhere, or the list writes to the author it is shown on (it holds no value).
let created: string | undefined
/** One of Ada's published posts; its draft names Alan here. */
const MOVED = 'post-06'
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  // Each a different doc: both at once.
  await Promise.all([created && target(info).deleteDoc(created, 'post'), target(info).name === 'studio' && target(info).resetDoc(MOVED, 'post')])
  created = undefined
})

test("J17: an author's form lists their posts, opens one in the next pane, and Add item creates a post by them", async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the reference's author type declares no incoming references decoration")
  const revBefore = t.docValue('author-ada', '_rev', 'author')
  // A draft that points away: Barkpark's filter still answers with the post's published version (Ada's).
  await bpMutate([{patch: {id: MOVED, type: 'post', set: {author: 'author-alan', title: 'Moved to Alan (draft)'}}}])
  await page.goto(t.docPath('author', 'author-ada'))
  await signInIfAsked(page)
  await t.settle(page)
  const list = page.getByTestId('incoming-posts')
  await expect(list.getByText('Posts by this author', {exact: true})).toBeVisible({timeout: 10_000})
  const row = (title: string) => list.getByTestId('incoming-item').filter({hasText: title})
  // Ada wrote every third fixture post; Alan's and Grace's are not hers. (Ten rows show
  // at first; a lane with more posts by Ada than the seed's has the rest behind "Show all".)
  await expect(list.getByTestId('incoming-item').first()).toBeVisible({timeout: 10_000})
  const more = list.getByRole('button', {name: /^Show all/})
  if (await more.isVisible()) await more.click()
  await expect(row('Fixture post 03')).toBeVisible()
  await expect(row('Fixture post 09')).toBeVisible()
  // The post whose draft names Alan is not hers as editors see it: not listed, under either title.
  await expect(list.locator(`a[href*="${MOVED}"]`)).toHaveCount(0)
  await expect(row('Fixture post 01')).toHaveCount(0)
  await expect(row('Fixture post 02')).toHaveCount(0)

  // A row is the post's own preview: it opens the post in the next pane, at the field that refers.
  await row('Fixture post 03').click()
  await expect.poll(() => decodeURIComponent(page.url()), {intervals: [50]}).toContain('/structure/author;author-ada;post-03,type=post,path=author')
  await expect(t.field(t.pane(page, 3), 'title')).toHaveValue('Fixture post 03')
  await expect(row('Fixture post 03')).toHaveAttribute('data-selected', '')

  // Add item: the type has a template too, so it asks which (J18); the new post opens in the next pane.
  await list.getByRole('button', {name: 'Add item'}).click()
  await page.getByRole('menuitem', {name: 'Post', exact: true}).click()
  await expect.poll(() => (created = decodeURIComponent(page.url()).match(/author-ada;([0-9a-f-]{36}),type=post/)?.[1]), {intervals: [50]}).toBeTruthy()
  // Listed at once, and it exists with this author as its author.
  await expect(list.locator(`a[href*="${created}"]`)).toBeVisible()
  await expect.poll(() => t.docValue(created!, 'author').then((a) => (a && typeof a === 'object' ? (a as {_ref: string})._ref : a)), {timeout: 10_000}).toBe('author-ada')
  await expect(t.field(t.pane(page, 3), 'title')).toBeVisible()
  // The list holds no value: nothing it did wrote to the author.
  expect(await t.docValue('author-ada', '_rev', 'author')).toBe(await revBefore)
})
