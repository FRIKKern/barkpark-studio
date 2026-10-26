import {expect, test, type Page} from '../rig/test'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

const imageField = (t: Target, page: Page) =>
  t.name === 'sanity' ? page.locator('fieldset').filter({has: page.getByTestId('image-input')}).last() : page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
test.setTimeout(90_000)

// task-dfe6a38d2340a4a2: Sanity draws a faint edge over every preview image, a span after
// the img (data-border): an inset 1 px of the text colour at a tenth, corners 1 px. It
// keeps a pale image apart from its row, darker on light and lighter on dark.
// Its own draft-only post (EDGE_DOC), deleted after: no seed doc is touched.
const EDGE_DOC = 'post-thumb-edge'
test('@local a row thumbnail has Sanity\'s faint edge over the image', async ({page}, info) => {
  const t = target(info)
  await t.draftOnly(EDGE_DOC, 'post', {title: 'Thumbnail edge'})
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', EDGE_DOC))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('tab', {name: 'Content'}).click()
    await imageField(t, page).locator('input[type=file]').first().setInputFiles('../fixtures/assets/fixture-image.png')
    const img = t.listItem(page, EDGE_DOC).locator('img').first()
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), {intervals: [100], timeout: 20_000}).toBe(true)
    const edge = await img.evaluate((i) => {
      const border = i.parentElement!.querySelector<HTMLElement>(':scope > img + [data-border]')
      if (!border) return 'no edge'
      const s = getComputedStyle(border)
      return `${s.position} ${s.boxShadow.replace(/rgba?\([^)]*\)\s*/, '')} ${s.opacity} ${s.borderRadius} ${getComputedStyle(i).borderRadius}`
    })
    expect(edge).toBe('absolute 0px 0px 0px 1px inset 0.1 1px 1px')
  } finally {
    await closeAndSettle(page)
    await t.deleteDoc(EDGE_DOC, 'post')
  }
})
