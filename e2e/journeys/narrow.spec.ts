import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J42, both studios, 500 px wide (under Sanity's 600 px collapse): one pane
// at a time with a back link; post → doc → author and back, back/forward, and a
// resize to wide and back keep the same URL and show the panes it names. Stills in
// e2e/evidence/J42-*.
const shot = (name: string, step: string) => `evidence/J42-${step}-${name}.png`
test.setTimeout(90_000)

/** Indexes of the panes that take real width (strips and hidden panes don't count). */
const shown = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-pane-index]')].filter((e) => e.getBoundingClientRect().width > 100).map((e) => Number(e.getAttribute('data-pane-index'))))
const back = (page: Page) => page.locator('a:has([data-sanity-icon="arrow-left"]), [data-testid="pane-back"]').filter({visible: true}).first()

test('@local J42: narrow window — one pane with a back link; URL and panes right both ways', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.setViewportSize({width: 500, height: 800})
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)

  await page.locator('a[href="/structure/post"]').first().click()
  await expect(page).toHaveURL(/\/structure\/post$/)
  await expect.poll(() => shown(page)).toEqual([1])
  await page.screenshot({path: shot(t.name, '1-list')})

  await t.listItem(page, 'post-02').click()
  await expect(t.field(page, 'title')).toHaveValue('Fixture post 02')
  await expect.poll(() => shown(page)).toEqual([2])
  await page.screenshot({path: shot(t.name, '2-doc')})

  await t.refLink(t.pane(page, 2), 'author').click()
  await expect(t.field(page, 'name')).toHaveValue(/Lovelace|Turing|Hopper/)
  await expect.poll(() => shown(page)).toEqual([3])
  await expect(page).toHaveURL(/post-02;author-[a-z]+/)

  // Back link: one group back each time.
  await back(page).click()
  await expect(page).toHaveURL(/\/structure\/post;post-02$/)
  await expect.poll(() => shown(page)).toEqual([2])
  await back(page).click()
  await expect(page).toHaveURL(/\/structure\/post$/)
  // Browser back/forward walk the same chain.
  await page.goBack()
  await expect(page).toHaveURL(/\/structure\/post;post-02$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/structure\/post$/)
  await page.goBack()

  // Wide and narrow again: same URL, the panes it names.
  await page.setViewportSize({width: 1440, height: 900})
  await expect.poll(() => shown(page)).toEqual([0, 1, 2])
  await expect(back(page)).toBeHidden()
  await page.screenshot({path: shot(t.name, '3-wide')})
  await page.setViewportSize({width: 500, height: 800})
  await expect.poll(() => shown(page)).toEqual([2])
  await expect(page).toHaveURL(/\/structure\/post;post-02$/)
  await page.screenshot({path: shot(t.name, '4-narrow-again')})
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true)
})

test('@local J42: an open inspector — earlier panes give way when wide, it takes the pane on a phone', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.setViewportSize({width: 1440, height: 800})
  await page.goto(t.docPath('post', 'post-02'))
  await signInIfAsked(page)
  await t.settle(page)
  await expect.poll(() => shown(page)).toEqual([0, 1, 2])
  // History from the document "…" menu (Sanity's menus stay mounted: take this button's).
  const menu = t.name === 'sanity' ? t.pane(page, 2).locator('button:has([data-sanity-icon="ellipsis-horizontal"])').first() : page.getByRole('button', {name: 'Show document actions'})
  const id = await menu.getAttribute('id')
  await menu.click()
  await page.waitForTimeout(t.name === 'sanity' ? 300 : 0)
  await (t.name === 'sanity' ? page.locator(`[role=menu][aria-labelledby="${id}"]`) : page.getByRole('menu')).getByRole('menuitem', {name: 'History'}).click()
  // Sanity's document needs 600 + 320 px with an inspector: the type list becomes a strip.
  await expect.poll(() => shown(page)).toEqual([1, 2])
  await page.screenshot({path: shot(t.name, '5-inspector-wide')})

  // A phone: the inspector takes the whole pane, the header stays one row.
  await page.setViewportSize({width: 390, height: 844})
  const note = page.getByText(/Showing the history for the/).first()
  await expect(note).toBeVisible()
  await expect(t.field(page, 'title')).toBeHidden()
  expect((await note.boundingBox())!.x).toBeLessThan(40)
  const actions = t.name === 'sanity' ? page.locator('[data-testid="document-pane"] button:has([data-sanity-icon="ellipsis-horizontal"])').first() : page.getByRole('button', {name: 'Show document actions'})
  const chip = (await page.getByText('Published', {exact: true}).first().boundingBox())!
  const dots = (await actions.boundingBox())!
  expect(Math.abs(chip.y + chip.height / 2 - (dots.y + dots.height / 2))).toBeLessThan(8)
  await page.screenshot({path: shot(t.name, '6-inspector-phone')})
})
