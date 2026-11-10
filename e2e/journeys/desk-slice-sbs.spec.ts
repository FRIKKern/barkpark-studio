import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {expect, test, type Page, type TestInfo} from '../rig/test'
import {median, stats} from '../rig/feel'
import {signInIfAsked, target} from '../rig/targets'

// The desk slice's scorecard (Paper desk-vertical-slice, "The scorecard"; task-1dff9c2f17b5b4d6):
// seven checks, the Phoenix desk (project `desk`) raced against our TanStack Studio (project
// `studio`) on one e2e-* dataset. The same file runs on either side and records what it
// measured there; run it once per side, then `node rig/desk-scorecard.mjs` prints both:
//   EVIDENCE=1 node run.mjs desk journeys/desk-slice-sbs.spec.ts
//   BARKPARK_DATASET=e2e-local-desk EVIDENCE=1 node run.mjs test journeys/desk-slice-sbs.spec.ts --project studio
// Every row is recorded (a test annotation, a `[scorecard] <row> <side> <json>` line, and
// test-results/desk-slice-<project>.json, copied to evidence/ because Playwright empties
// test-results at the start of the next run), then its pass bar is a soft check: a missed
// bar turns the run red without hiding the other rows. Read-only.
const SIDES: Record<string, string> = {desk: 'LiveView desk', studio: 'TanStack Studio'}
const DATASET = process.env.BARKPARK_DATASET ?? ''

test.skip(!/^e2e-/.test(DATASET), 'the scorecard runs on an e2e-* dataset only, never production')
test.describe.configure({timeout: 120_000})
test.beforeEach(({}, info) => test.skip(!(info.project.name in SIDES), 'the desk against ours: projects desk and studio'))

type Verdict = {pass: boolean; summary: string}
const results = (project: string) => new URL(`../test-results/desk-slice-${project}.json`, import.meta.url)
const kept = (project: string) => new URL(`../evidence/desk-slice-${project}.json`, import.meta.url)

/** One row into the run's annotations, its log and the side's JSON file. */
function record(info: TestInfo, n: number, row: Verdict & {check: string; bar: string}) {
  const side = info.project.name
  const json = JSON.stringify(row)
  info.annotations.push({type: `scorecard ${n}`, description: json})
  console.log(`[scorecard] ${n} ${side} ${json}`)
  const file = results(side)
  const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {side, label: SIDES[side], dataset: DATASET, ran: new Date().toISOString(), rows: {}}
  all.rows[n] = row
  mkdirSync(new URL('.', file), {recursive: true})
  writeFileSync(file, JSON.stringify(all, null, 2) + '\n')
  mkdirSync(new URL('.', kept(side)), {recursive: true})
  copyFileSync(file, kept(side))
}

/**
 * Measure one row and record it. Whatever the measurement throws (a pane that never came)
 * becomes a failed row with the reason, recorded like the rest: one missing pane must
 * not leave a row out of the scorecard.
 */
async function scoreRow(info: TestInfo, n: number, check: string, bar: string, measure: (out: Record<string, unknown>) => Promise<Verdict>) {
  const out: Record<string, unknown> = {}
  let verdict: Verdict
  try {
    verdict = await measure(out)
  } catch (e) {
    out.error = String((e as Error).message ?? e).split('\n')[0]!.slice(0, 300)
    verdict = {pass: false, summary: `did not finish: ${out.error}`}
  }
  record(info, n, {check, bar, ...verdict, ...out})
  expect.soft(verdict.pass, `row ${n}, ${check} (${bar}): ${verdict.summary}`).toBe(true)
}

type PaneSeen = {kind: string; title: string; strip: boolean; busy: boolean}
/** Each pane on screen, left to right. The desk names its kind (data-pane-kind); ours says it in data-pane (types, menu:<id>, list:<type>, doc:<id>). Our strips carry no kind. */
const panesNow = (page: Page): Promise<PaneSeen[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-pane-index]')].map((el) => {
      const strip = el.hasAttribute('data-pane-collapsed')
      const kind = el.getAttribute('data-pane-kind') ?? el.getAttribute('data-pane')?.split(':')[0] ?? (strip ? 'strip' : '?')
      const title = (el.querySelector('.pane-header .title, .pane-header-title, .strip-title')?.textContent ?? el.getAttribute('aria-label') ?? '').trim()
      return {kind, title, strip, busy: el.getAttribute('aria-busy') === 'true'}
    }),
  )
/** Until `count` panes are on screen and none is still reading (aria-busy): false if not within `timeout`. */
const quiet = (page: Page, count: number, timeout = 15_000) =>
  page
    .waitForFunction((n) => document.querySelectorAll('[data-pane-index]').length === n && !document.querySelector('[data-pane-index][aria-busy="true"]'), count, {timeout, polling: 50})
    .then(() => true, () => false)
const path = (page: Page) => decodeURIComponent(new URL(page.url()).pathname)
const strips = (page: Page) => page.locator('[data-pane-index]').evaluateAll((els) => els.map((e) => e.hasAttribute('data-pane-collapsed')))

/** Open `url`, signed in and settled, with `count` panes quiet. */
async function open(page: Page, info: TestInfo, url: string, count: number) {
  await page.goto(url)
  await signInIfAsked(page)
  await target(info).settle(page)
  return quiet(page, count)
}

/**
 * Click, then ms from the pointerdown to the first frame where each check's selector
 * shows an element with a height (polled every frame in the page). A check not seen
 * within `limit` ms is null. Selectors, not code: the desk's CSP has no eval.
 */
async function clickAndTime(page: Page, click: () => Promise<void>, checks: Record<string, string>, limit = 15_000): Promise<Record<string, number | null>> {
  const watch = page.evaluate(
    ({checks, limit}) =>
      new Promise<Record<string, number | null>>((resolve) => {
        const out: Record<string, number | null> = {}
        let t0 = 0
        addEventListener('pointerdown', () => (t0 = performance.now()), {once: true, capture: true})
        const seen = (sel: string) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().height > 0)
        const tick = () => {
          if (t0) for (const [k, sel] of Object.entries(checks)) if (!(k in out) && seen(sel)) out[k] = Math.round(performance.now() - t0)
          if (Object.keys(out).length === Object.keys(checks).length) return resolve(out)
          if (t0 && performance.now() - t0 > limit) return resolve(Object.fromEntries(Object.keys(checks).map((k) => [k, out[k] ?? null])))
          requestAnimationFrame(tick)
        }
        tick()
      }),
    {checks, limit},
  )
  await click()
  return watch
}

/** Types in the root pane to click: the fixture's, as many as the desk tree shows. */
async function rootTypes(page: Page) {
  const hrefs = await page.locator('[data-pane-index="0"] a[href^="/structure/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  return ['post', 'author', 'category', 'bulk'].filter((type) => hrefs.includes(`/structure/${type}`))
}
/** Open type lists from the root, `times` clicks round the types; back to the root after each. */
async function openLists(page: Page, times: number, limit = 15_000) {
  const types = await rootTypes(page)
  if (!types.length) throw new Error('no fixture type (post, author, category, bulk) in the root pane')
  const clicks: {type: string; frame: number | null; rows: number | null}[] = []
  for (let i = 0; i < times; i++) {
    const type = types[i % types.length]!
    const link = page.locator(`[data-pane-index="0"] a[href="/structure/${type}"]`).first()
    const ms = await clickAndTime(page, () => link.click(), {frame: '[data-pane-index="1"]', rows: `[data-pane-index="1"] a[href^="/structure/${type};"]`}, limit)
    clicks.push({type, frame: ms.frame ?? null, rows: ms.rows ?? null})
    await page.goBack({waitUntil: 'commit'})
    if (!(await quiet(page, 1, limit))) throw new Error(`back to the root after opening ${type}: its list pane stayed`)
  }
  return clicks
}
const numbers = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null)

// Row 1: deep links into the fixture (posts, authors, categories, references followed with
// and without type=). Per URL, the pane kinds it should open, left to right.
const chain = (n: number) =>
  '/structure/post;post-01' + [';author-alan,type=author,parentRefPath=author', ';category-guide,type=category,parentRefPath=expertise', ';post-04,type=post,parentRefPath=featuredPost'].slice(0, n).join('')
const URLS: [string, string[]][] = [
  ['/structure', ['types']],
  ['/structure/post', ['types', 'list']],
  ['/structure/author', ['types', 'list']],
  ['/structure/category', ['types', 'list']],
  ['/structure/post;post-01', ['types', 'list', 'doc']],
  ['/structure/post;post-30', ['types', 'list', 'doc']],
  ['/structure/author;author-ada', ['types', 'list', 'doc']],
  ['/structure/post;post-02;author-alan', ['types', 'list', 'doc', 'doc']],
  [chain(1), ['types', 'list', 'doc', 'doc']],
  [chain(3), ['types', 'list', 'doc', 'doc', 'doc', 'doc']],
]

test('@evidence desk slice 1: the same pane URLs open the same panes', async ({page}, info) => {
  await scoreRow(info, 1, 'Same pane URL opens the same panes', '10 of 10 links', async (out) => {
    const urls: {url: string; want: string[]; kinds: string[]; titles: string[]; ok: boolean}[] = []
    out.urls = urls
    for (const [url, want] of URLS) {
      const done = await open(page, info, url, want.length).catch(() => false)
      const seen = await panesNow(page)
      // A strip is checked by count only: ours draws it without its kind.
      const ok = done && seen.length === want.length && seen.every((p, i) => p.strip || p.kind === want[i])
      urls.push({url, want, kinds: seen.map((p) => (p.strip ? `${p.kind}(strip)` : p.kind)), titles: seen.map((p) => p.title), ok})
    }
    const passed = urls.filter((u) => u.ok).length
    return {pass: passed === URLS.length, summary: `${passed} of ${URLS.length}` + (passed < URLS.length ? `; wrong: ${urls.filter((u) => !u.ok).map((u) => u.url).join(', ')}` : '')}
  })
})

test('@evidence desk slice 2 3: click to pane frame, click to rows (median of 10)', async ({page}, info) => {
  let clicks: Awaited<ReturnType<typeof openLists>> = []
  const measured = (async () => {
    if (!(await open(page, info, '/structure', 1))) throw new Error('the root pane never settled')
    clicks = await openLists(page, 10)
  })()
  await scoreRow(info, 2, 'Click to pane frame', 'under 50 ms', async (out) => {
    await measured
    const ms = numbers(clicks.map((c) => c.frame))
    Object.assign(out, {clicks, ...stats(ms), median: ms.length ? median(ms) : null, missing: clicks.length - ms.length})
    const m = ms.length ? median(ms) : Infinity
    return {pass: ms.length === clicks.length && m < 50, summary: `median ${m} ms, p95 ${stats(ms).p95}, max ${stats(ms).max} (n=${ms.length}/${clicks.length})`}
  })
  await scoreRow(info, 3, 'Click to rows', 'median under 150 ms', async (out) => {
    await measured
    const ms = numbers(clicks.map((c) => c.rows))
    Object.assign(out, {clicks, ...stats(ms), median: ms.length ? median(ms) : null, missing: clicks.length - ms.length})
    const m = ms.length ? median(ms) : Infinity
    return {pass: ms.length === clicks.length && m < 150, summary: `median ${m} ms, p95 ${stats(ms).p95}, max ${stats(ms).max} (n=${ms.length}/${clicks.length})`}
  })
})

// Chrome DevTools' Slow 4G preset (its old "Fast 3G"): 562.5 ms RTT, 1.6 Mbps down, 750 kbps up.
const SLOW_4G = {offline: false, latency: 562.5, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9}
// A dead click: nothing on screen 300 ms after it (QUALITY.md F14: a loading state within 300 ms).
const DEAD_MS = 300

test('@evidence desk slice 4: Slow 4G, frame still instant, rows fill in, no dead click', async ({page, context}, info) => {
  test.setTimeout(180_000)
  const t = target(info)
  await scoreRow(info, 4, 'Slow 4G', 'frame under 50 ms, rows fill in, no dead click', async (out) => {
    if (!(await open(page, info, '/structure', 1))) throw new Error('the root pane never settled')
    // Loaded at full speed; only the clicks are slowed. The desk's slow network is its proxy
    // (Chrome's throttling does not delay an open WebSocket's frames); ours is Chrome's.
    if (t.network) await t.network(SLOW_4G)
    else await (await context.newCDPSession(page)).send('Network.emulateNetworkConditions', SLOW_4G)
    try {
      const clicks = await openLists(page, 3, 30_000)
      // A second click while the first one's pane still reads: it must win.
      const [a, b] = (await rootTypes(page)).slice(0, 2)
      if (!a || !b) throw new Error('two fixture types are needed in the root pane')
      await page.locator(`[data-pane-index="0"] a[href="/structure/${a}"]`).first().click()
      await page.waitForTimeout(100)
      const second = await clickAndTime(page, () => page.locator(`[data-pane-index="0"] a[href="/structure/${b}"]`).first().click(), {frame: '[data-pane-index="1"]', rows: `[data-pane-index="1"] a[href^="/structure/${b};"]`}, 30_000)
      const landed = (await quiet(page, 2, 30_000)) && path(page) === `/structure/${b}`
      const all = [...clicks.map((c) => ({...c, second: false})), {type: `${b} (after ${a})`, frame: second.frame ?? null, rows: second.rows ?? null, second: true}]
      const dead = all.filter((c) => c.frame === null || c.frame > DEAD_MS || c.rows === null).length + (landed ? 0 : 1)
      const frames = numbers(all.map((c) => c.frame))
      const rows = numbers(all.map((c) => c.rows))
      Object.assign(out, {shape: SLOW_4G, clicks: all, secondClickLanded: landed, dead, frame: stats(frames), rows: stats(rows)})
      const instant = frames.length === all.length && Math.max(...frames) < 50
      return {
        pass: instant && rows.length === all.length && dead === 0,
        summary: `frame max ${stats(frames).max} ms, rows median ${rows.length ? median(rows) : '-'} ms (max ${stats(rows).max}), dead clicks ${dead} of ${all.length}${landed ? '' : ', the second click lost'}`,
      }
    } finally {
      await t.network?.(null)
    }
  })
})

/** Watch every frame until stopped: frames where a pane went missing or showed nothing (blank), or read (busy). */
const watchFrames = (page: Page, need: number) =>
  page.evaluate((need) => {
    const w = window as unknown as {__bf: {on: boolean; frames: number; blank: number; busy: number; fewest: number; first: string}}
    const f = (w.__bf = {on: true, frames: 0, blank: 0, busy: 0, fewest: Infinity, first: ''})
    const tick = () => {
      if (!f.on) return
      const shown = [...document.querySelectorAll<HTMLElement>('[data-pane-index]')].filter((p) => p.getBoundingClientRect().width > 0)
      const empty = shown.filter((p) => !p.hasAttribute('data-pane-collapsed') && !(p.innerText ?? '').trim())
      f.frames++
      f.fewest = Math.min(f.fewest, shown.length)
      if (shown.length < need || empty.length) {
        f.blank++
        f.first ||= `frame ${f.frames}: ${shown.length} panes shown, ${empty.length} empty`
      }
      if (shown.some((p) => p.getAttribute('aria-busy') === 'true')) f.busy++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, need)
const stopFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {__bf: {on: boolean; frames: number; blank: number; busy: number; fewest: number; first: string}}
    w.__bf.on = false
    return {frames: w.__bf.frames, blank: w.__bf.blank, busy: w.__bf.busy, fewest: w.__bf.fewest, first: w.__bf.first}
  })

test('@evidence desk slice 5: back and forward, no blank frame', async ({page}, info) => {
  const t = target(info)
  await scoreRow(info, 5, 'Back and forward', 'no blank frame', async (out) => {
    if (!(await open(page, info, '/structure/post', 2))) throw new Error('the post list never settled')
    for (const id of ['post-01', 'post-02']) {
      await t.listItem(page, id).first().click()
      await expect.poll(() => path(page)).toBe(`/structure/post;${id}`)
      if (!(await quiet(page, 3))) throw new Error(`${id} never settled`)
    }
    const steps: {step: string; to: string; landed: boolean; frames: number; blank: number; busy: number; first: string}[] = []
    out.steps = steps
    for (const [step, to, count] of [
      ['back', '/structure/post;post-01', 3],
      ['forward', '/structure/post;post-02', 3],
      ['back', '/structure/post;post-01', 3],
      ['back', '/structure/post', 2],
      ['forward', '/structure/post;post-01', 3],
    ] as const) {
      const before = (await panesNow(page)).length
      await watchFrames(page, Math.min(before, count))
      await (step === 'back' ? page.goBack({waitUntil: 'commit'}) : page.goForward({waitUntil: 'commit'}))
      const landed = (await expect.poll(() => path(page), {timeout: 10_000}).toBe(to).then(() => true, () => false)) && (await quiet(page, count))
      await page.waitForTimeout(300) // a late repaint counts too
      const seen = await stopFrames(page)
      steps.push({step, to, landed, ...seen})
    }
    const blank = steps.reduce((s, x) => s + x.blank, 0)
    const busy = steps.reduce((s, x) => s + x.busy, 0)
    const lost = steps.filter((s) => !s.landed).length
    return {pass: blank === 0 && lost === 0, summary: `${blank} blank frames, ${busy} frames with a pane still reading, over ${steps.length} steps${lost ? `; ${lost} never landed` : ''}`}
  })
})

test('@evidence desk slice 6: ArrowDown, Enter, cmd-click', async ({page, context}, info) => {
  await scoreRow(info, 6, 'Arrow keys, Enter, cmd-click', 'all work', async (out) => {
    if (!(await open(page, info, '/structure/post', 2))) throw new Error('the post list never settled')
    const rows = page.locator('[data-pane-index="1"] a[href^="/structure/post;"]')
    const href = (i: number) => rows.nth(i).getAttribute('href').then((h) => decodeURIComponent(h ?? ''))
    const [first, second, third] = [await href(0), await href(1), await href(2)]
    const focused = () => page.evaluate(() => decodeURIComponent(document.activeElement?.getAttribute('href') ?? document.activeElement?.tagName ?? ''))
    await rows.first().focus()
    await page.keyboard.press('ArrowDown')
    const arrow = {from: first, want: second, got: await focused()}
    const arrowDown = arrow.got === second
    // Enter on the second row, focused by hand when ArrowDown did not get there: each key counts alone.
    if (!arrowDown) await rows.nth(1).focus()
    await page.keyboard.press('Enter')
    const enter = (await expect.poll(() => path(page), {timeout: 10_000}).toBe(second).then(() => true, () => false)) && (await quiet(page, 3))
    // cmd-click (ctrl elsewhere): a new tab on the same chain, this one left as it was.
    const here = path(page)
    const tab = await Promise.all([context.waitForEvent('page', {timeout: 10_000}), rows.nth(2).click({modifiers: ['ControlOrMeta']})]).then(([p]) => p, () => null)
    let tabPath = ''
    let tabPanes = 0
    if (tab) {
      await tab.waitForLoadState()
      tabPath = path(tab)
      tabPanes = (await quiet(tab, 3)) ? 3 : (await panesNow(tab)).length
      await tab.close()
    }
    const cmdClick = tabPath === third && tabPanes === 3 && path(page) === here
    Object.assign(out, {arrow, arrowDown, enter, cmdClick: {want: third, tab: tabPath || null, tabPanes, stayed: path(page) === here}})
    const ok = {ArrowDown: arrowDown, Enter: enter, 'cmd-click': cmdClick}
    return {pass: arrowDown && enter && cmdClick, summary: Object.entries(ok).map(([k, v]) => `${k} ${v ? 'ok' : 'FAILS'}`).join(', ')}
  })
})

// Row 7: Sanity's collapse rule (app/src/lib/layout.ts `collapsed`, focus on the last pane)
// for these chains, worked out once per width: true is a strip.
const WIDTHS = [1440, 1200, 1024, 800, 640]
const LAYOUTS: [string, Record<number, boolean[]>][] = [
  ['/structure/post;post-01', {1440: [false, false, false], 1200: [true, false, false], 1024: [true, false, false], 800: [true, true, false], 640: [true, true, false]}],
  [chain(1), {1440: [true, true, false, false], 1200: [true, false, true, false], 1024: [true, true, true, false], 800: [true, true, true, false], 640: [true, true, true, false]}],
]

test('@evidence desk slice 7: collapsed panes at five widths', async ({page}, info) => {
  await scoreRow(info, 7, 'Collapse at five widths', 'the same panes collapsed as TanStack (Sanity\'s rule)', async (out) => {
    const layouts: {url: string; width: number; want: boolean[]; strips: boolean[]; ok: boolean}[] = []
    out.layouts = layouts
    for (const [url, want] of LAYOUTS) {
      await page.setViewportSize({width: 1440, height: 900})
      if (!(await open(page, info, url, want[1440]!.length))) throw new Error(`${url} never settled`)
      for (const width of WIDTHS) {
        await page.setViewportSize({width, height: 900})
        // The layout follows the resize a frame or a transition later: up to 3 s to match.
        const ok = await expect.poll(() => strips(page), {timeout: 3_000, intervals: [50, 100]}).toEqual(want[width]).then(() => true, () => false)
        layouts.push({url, width, want: want[width]!, strips: await strips(page), ok})
      }
    }
    const passed = layouts.filter((l) => l.ok).length
    const shown = (s: boolean[]) => s.map((x) => (x ? 's' : 'o')).join('')
    return {pass: passed === layouts.length, summary: `${passed} of ${layouts.length} match` + (passed < layouts.length ? `; ${layouts.filter((l) => !l.ok).map((l) => `${l.width}px ${shown(l.strips)} (want ${shown(l.want)})`).join(', ')}` : '')}
  })
})
