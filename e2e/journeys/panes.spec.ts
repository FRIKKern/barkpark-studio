import AxeBuilder from '@axe-core/playwright'
import {expect, test, type Page} from '@playwright/test'
import {installProbes, median, networkBudget, timeToReady} from '../rig/feel'
import {seededCount, target} from '../rig/targets'
import {referenceHold} from '../rig/reference'

// Crown slice, one spec for both studios: J01 (list), J02 (deep URL restore),
// J21 (endless pane chain). The same steps run against reference/sanity and ours,
// so "matches Sanity" is checked, not remembered. Feel budgets apply to ours only.

const CHAIN = [
  ['author', 'author-alan'],
  ['expertise', 'category-guide'],
  ['featuredPost', 'post-04'],
  ['author', 'author-alan'],
  ['expertise', 'category-guide'],
  ['featuredPost', 'post-04'],
] as const
const TYPE = {author: 'author', expertise: 'category', featuredPost: 'post'} as const
const chainUrl = (n: number) =>
  '/structure/post;post-01' +
  CHAIN.slice(0, n)
    .map(([field, id]) => `;${id},type=${TYPE[field]},parentRefPath=${field}`)
    .join('')

// Page-state polls: check every 50 ms, not the default's growing steps.
const LOCAL_POLL = {intervals: [50, 100]}
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
  else await expect(t.listItem(page, 'post-02')).toBeVisible()
  const coldMs = Date.now() - t0
  await referenceHold(page, t.listItem(page, 'post-02'))

  // F2: the median of three warm opens of different docs (one open on a shared runner
  // is a noisy sample); post-02 last, so what follows reads it. Every open: no shift.
  const opens = []
  for (const id of ['post-03', 'post-04', 'post-02'])
    opens.push(await timeToReady(page, t.listItem(page, id), `(w) => document.getElementById('title')?.value === w`, `Fixture post ${id.slice(-2)}`))
  const open = {ms: median(opens.map((o) => o.ms)), cls: Math.max(...opens.map((o) => o.cls)), shifted: opens.map((o) => o.shifted).filter(Boolean).join(' | ')}
  expect(path(page)).toBe('/structure/post;post-02')
  await expect(t.listItem(page, 'post-02')).toHaveAttribute('data-selected')
  await referenceHold(page, t.field(page, 'title'), 'Fixture post 02')
  await expect(page).toHaveTitle(/^Fixture post 02 \| /)

  await page.reload()
  await expect(t.field(page, 'title')).toHaveValue('Fixture post 02')
  await expect(page).toHaveTitle(/^Fixture post 02 \| /)
  expect(await strips(page)).toEqual([false, false, false])
  await referenceHold(page, t.field(page, 'title'), 'Fixture post 02')

  if (t.name === 'studio') {
    expect(coldMs, 'F3 cold load to usable list').toBeLessThan(networkBudget(1500))
    expect(open.ms, 'F2 pane open (warm, median of 3)').toBeLessThan(100)
    expect(open.cls, `F2 zero layout shift (moved: ${open.shifted})`).toBe(0)
    // F13: the list + open post, WCAG 2.1 AA by axe (the full J01–J04 scan is a11y.spec.ts).
    const {violations} = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), 'F13 axe').toEqual([])
  }
})

test('J21: endless pane chain — strips, URL round-trip, back/forward, close', async ({page}, info) => {
  const t = target(info)
  await page.goto('/structure/post;post-01')
  await t.settle(page)
  await expect(t.field(page, 'title')).toHaveValue('Fixture post 01')
  await referenceHold(page, t.field(page, 'title'), 'Fixture post 01')

  // Follow references 6 deep: 9 panes. Each opens to the right of the last.
  const chainStart = await page.evaluate(() => performance.now())
  const opens: number[] = []
  for (const [i, [field, id]] of CHAIN.entries()) {
    const from = t.pane(page, i + 2)
    const opened = await timeToReady(page, t.refLink(from, field), `(id) => !!document.querySelector('[data-pane-index="${i + 3}"]') && location.pathname.includes(id)`, id, 0)
    opens.push(opened.ms)
    const fieldName = field === 'author' ? 'name' : 'title'
    const value = field === 'author' ? 'Alan Turing' : field === 'expertise' ? 'Guide' : 'Fixture post 04'
    await referenceHold(page, t.pane(page, i + 3).locator(`[id="${fieldName}"]`), value)
  }
  // F2 over the chain's opens: their median (each one is in the run's feel log).
  if (t.name === 'studio') expect(median(opens), 'F2 open (median of the chain)').toBeLessThan(100)
  // One settling window for the whole chain; per-pane waits added 1.5 s while
  // their CLS results went unused. Include every shift since the first click.
  await page.waitForTimeout(300)
  if (t.name === 'studio') expect(await page.evaluate((start) => window.__feel.shifts.filter((s) => s.t >= start).reduce((sum, s) => sum + s.v, 0), chainStart), 'F2 chain layout shift').toBe(0)
  expect(path(page)).toBe(chainUrl(6))
  // Sanity's layout at 1440 px: only the focused (last) pane stays open.
  expect(await strips(page)).toEqual([true, true, true, true, true, true, true, true, false])
  if (t.name === 'studio') await expect(page, 'F10 visual').toHaveScreenshot('j21-chain.png', {maxDiffPixelRatio: 0.01})

  // URL round-trips: back, forward, reload.
  await page.goBack()
  await expect.poll(() => path(page), LOCAL_POLL).toBe(chainUrl(5))
  await expect(page.locator('[data-pane-index]')).toHaveCount(8)
  await referenceHold(page, t.pane(page, 7).locator('[id="title"]'), 'Guide')
  await page.goForward()
  await expect.poll(() => path(page), LOCAL_POLL).toBe(chainUrl(6))
  await referenceHold(page, t.pane(page, 8).locator('[id="title"]'), 'Fixture post 04')
  await page.reload()
  await expect(page.locator('[data-pane-index]')).toHaveCount(9)
  // The reference mounts all nine loading panes before restoring their layout.
  if (process.env.RECORDING_RUN_ID && t.name === 'sanity') {
    await referenceHold(page, page.locator('[data-pane-index]:not([data-pane-collapsed])').locator('input[id="title"], input[id="name"]').last())
    // Keep a reference mismatch red in the report, but record the remaining
    // actions too so reviewers can see the actual behavior after a reload.
    expect.soft(await strips(page), 'Reference layout after reload').toEqual([true, true, true, true, true, true, true, true, false])
  } else {
    await expect.poll(() => strips(page), LOCAL_POLL).toEqual([true, true, true, true, true, true, true, true, false])
  }

  // A strip opens on click; the others make room (keyboard too, on ours).
  if (t.name === 'sanity') await t.pane(page, 3).locator('[data-testid="pane-header"] [tabindex="0"]').first().click()
  else await t.pane(page, 3).click({position: {x: 25, y: 300}})
  await expect.poll(() => strips(page), LOCAL_POLL).toEqual([true, true, true, false, true, true, true, true, true])
  await referenceHold(page, t.pane(page, 3).locator('[id="name"]'), 'Alan Turing')
  if (t.name === 'studio') {
    await t.pane(page, 5).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => strips(page), LOCAL_POLL).toEqual([true, true, true, true, true, false, true, true, true])
    await expect(t.pane(page, 5)).toBeFocused()
    await t.pane(page, 3).focus()
    await page.keyboard.press('Enter')
  }

  // Closing a pane closes it and everything to its right.
  await t.closeButton(t.pane(page, 3)).click()
  await expect.poll(() => path(page), LOCAL_POLL).toBe('/structure/post;post-01')
  await expect(page.locator('[data-pane-index]')).toHaveCount(3)
  await referenceHold(page, t.pane(page, 2).locator('[id="title"]'), 'Fixture post 01')

  // F5: a reference opens from the keyboard.
  await t.refLink(t.pane(page, 2), 'author').focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => path(page), LOCAL_POLL).toBe(chainUrl(1))
  await referenceHold(page, t.pane(page, 3).locator('[id="name"]'), 'Alan Turing')
  if (t.name === 'studio') {
    // More strips than the viewport can fit must not clip the active editor.
    await page.setViewportSize({width: 768, height: 900})
    await page.goto(chainUrl(6) + chainUrl(6).slice('/structure/post;post-01'.length))
    await expect(t.pane(page, 14)).toBeVisible()
    await expect.poll(() => t.pane(page, 14).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.left >= 0 && r.right <= innerWidth
    }), LOCAL_POLL).toBe(true)
  }
})
