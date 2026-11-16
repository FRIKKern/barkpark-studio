import AxeBuilder from '@axe-core/playwright'
import {expect, test, type Page} from '../rig/test'
import {installProbes, median, networkBudget, timeToReady} from '../rig/feel'
import {seededCount, target, reveal} from '../rig/targets'
import {referenceHold} from '../rig/reference'

// Crown slice, one spec for both studios: J01 (list) and J02 (deep URL restore). The same
// steps run against reference/sanity and ours, so "matches Sanity" is checked, not
// remembered. Feel budgets apply to ours only. J21 (the pane chain) is panes.spec; split
// for CI's shards (task-c1df532bed870536).

const path = (page: Page) => decodeURIComponent(new URL(page.url()).pathname)
/** Per pane: true when collapsed to a strip. */
const strips = (page: Page) =>
  page.locator('[data-pane-index]').evaluateAll((els) => els.map((e) => e.hasAttribute('data-pane-collapsed')))

test.beforeEach(async ({context}, info) => {
  await Promise.all([target(info).prepare(context), installProbes(context)])
})


test('J01 J02: open the post list, open a post, reload the deep URL', async ({page}, info) => {
  const t = target(info)
  const posts = t.name === 'studio' ? await seededCount(t, 'post') : 0 // before the clock: it asks the backend
  const t0 = Date.now()
  await page.goto('/structure')
  await t.settle(page)
  await page.locator('a[href="/structure/post"]').click()
  // Sanity virtualises the list (renders ~25 rows); ours renders all of them.
  if (t.name === 'studio') await expect(page.locator('a[href^="/structure/post;"]')).toHaveCount(posts)
  else await expect(await reveal(t.listItem(page, 'post-02'))).toBeVisible()
  const coldMs = Date.now() - t0
  await referenceHold(page, t.listItem(page, 'post-02'))

  // F2: the median of three warm opens of different docs (one open on a shared runner
  // is a noisy sample); post-02 last, so what follows reads it. Every open: no shift.
  const opens = []
  for (const id of ['post-03', 'post-04', 'post-02'])
    opens.push(await timeToReady(page, await reveal(t.listItem(page, id)), `(w) => document.querySelector(${JSON.stringify(t.fieldSelector('title'))})?.value === w`, `Fixture post ${id.slice(-2)}`))
  const open = {ms: median(opens.map((o) => o.ms)), cls: Math.max(...opens.map((o) => o.cls)), shifted: opens.map((o) => o.shifted).filter(Boolean).join(' | ')}
  expect(path(page)).toBe('/structure/post;post-02')
  await expect(t.listItem(page, 'post-02')).toHaveAttribute('data-selected')
  await referenceHold(page, t.field(page, 'title'), 'Fixture post 02')
  await expect(page).toHaveTitle(/^Fixture post 02 \| /)
  // Sanity's panes are 320 wide, each followed by a 1 px line: the document starts at 642.
  if (t.name === 'studio') expect((await page.getByTestId('document-pane').boundingBox())!.x).toBe(642)

  await page.reload()
  await expect(t.field(page, 'title')).toHaveValue('Fixture post 02')
  await expect(page).toHaveTitle(/^Fixture post 02 \| /)
  expect(await strips(page)).toEqual([false, false, false])
  // The opened doc takes focus, as Sanity's does once its form is ready: its first
  // group tab, four Tabs from the title.
  await expect(page.getByRole('tab', {name: 'All fields'})).toBeFocused()
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab')
  await expect(t.field(page, 'title')).toBeFocused()
  await referenceHold(page, t.field(page, 'title'), 'Fixture post 02')

  if (t.name === 'studio') {
    expect(coldMs, 'F3 cold load to usable list').toBeLessThan(networkBudget(1500))
    expect(open.ms, 'F2 pane open (warm, median of 3)').toBeLessThan(100)
    expect(open.cls, `F2 zero layout shift (moved: ${open.shifted})`).toBe(0)
    // F13: the list + open post, WCAG 2.1 AA by axe (the full J01–J04 scan is a11y.spec.ts).
    const {violations} = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), 'F13 axe').toEqual([])
  }

  // A link in Sanity's own form opens the same in both: a followed doc without type=,
  // and an inspector by Sanity's name (History, on its Review changes tab).
  await page.goto('/structure/post;post-02;author-alan')
  await expect(page).toHaveTitle(/^Alan Turing \| /)
  await page.goto('/structure/post;post-02,since=@lastPublished,changesInspectorTab=review,inspect=sanity%2Fstructure%2Fhistory')
  await expect(page.getByRole('tab', {name: 'Review changes'})).toHaveAttribute('aria-selected', 'true')
})
