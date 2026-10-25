import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// A long title, as Sanity shows it: the title bar under the header stays one line with an
// ellipsis, and the heading breaks a long word inside the pane instead of running past it.
// @local: layout, visible when it breaks (CI's 5 s per journey rule).
test('@local a long title: one-line title bar, the heading breaks long words', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the scout still')
  const id = `post-long-${Date.now().toString(36)}`
  const title = `A very long title that keeps going and going ${'Supercalifragilisticexpialidocious'.repeat(4)} end`
  await t.draftOnly(id, 'post', {title, slug: {_type: 'slug', current: id}})
  try {
    await t.prepare(context)
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    const bar = page.locator('.doc-title-bar .title-row > .title')
    await expect(bar).toHaveText(title)
    expect(await bar.evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(25)
    const h1 = page.locator('.doc-form h1')
    await expect(h1).toHaveText(title)
    expect(await h1.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  } finally {
    await t.deleteDoc(id, 'post')
  }
})
