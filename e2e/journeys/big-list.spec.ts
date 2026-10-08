import {expect, test, type Page} from '@playwright/test'
import {installProbes, timeToReady} from '../rig/feel'
import {target} from '../rig/targets'

// J41, both studios, on the 5,000 `bulk` docs (scripts/seed-bulk.mjs; local datasets
// only, hence @local). Scroll loads more near the bottom up to Sanity's 2,000 with
// its note; list search finds a doc the loaded rows don't hold; F11: 60 fps scroll.

const overList = async (page: Page) => {
  const box = (await page.locator('a[href^="/structure/bulk;"]').first().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 200)
}

/** F11: scroll the loaded list `steps` wheel notches up; frame times while it moves. */
async function frames(page: Page, steps: number) {
  await page.evaluate(() => {
    const w = window as {__frames?: number[]; __sampling?: boolean}
    w.__frames = []
    w.__sampling = true
    const tick = (t: number) => {
      w.__frames!.push(t)
      if (w.__sampling) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const position = () => page.locator('a[href^="/structure/bulk;"]').first().evaluate((row) => {
    for (let el = row.parentElement; el; el = el.parentElement)
      if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el.scrollTop
    throw new Error('No scrollable list ancestor')
  })
  const start = await position()
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, -600)
  // Wheel dispatch returns before the last scroll is presented.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const distance = start - await position()
  const f = await page.evaluate(() => {
    const w = window as {__frames?: number[]; __sampling?: boolean}
    w.__sampling = false
    return w.__frames!
  })
  const d = f.slice(1).map((t, i) => t - f[i]!).sort((a, b) => a - b)
  expect(distance, 'F11 measures moving rows, not idle frames at the top').toBeGreaterThan(steps * 600 * 0.8)
  return {mean: d.reduce((a, b) => a + b, 0) / d.length, p95: d[Math.floor(d.length * 0.95)]!, n: d.length, distance}
}

test('@local J41: big list pages to 2,000 with the note; search reaches past it', async ({page}, info) => {
  test.setTimeout(90_000)
  const t = target(info)
  await Promise.all([t.prepare(page.context()), installProbes(page.context())])
  await page.goto(t.listPath('bulk'))
  await t.settle(page)
  await expect(page.locator('a[href^="/structure/bulk;"]').first()).toBeVisible()

  // Scroll to the end: more loads near the bottom, until Sanity's 2,000 and its note.
  const note = page.getByText('Displaying a maximum of 2000 documents')
  await overList(page)
  // isVisible() also accepts an off-screen footer: stopping there measured
  // scrolling back to the top of just the first page, then mostly idle frames.
  const atEnd = () => note.evaluateAll(([el]) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.top < innerHeight && r.bottom > 0
  })
  for (let i = 0; i < 400 && !(await atEnd()); i++) await page.mouse.wheel(0, 3000)
  await expect(note).toBeInViewport()

  const f = await frames(page, 40)
  console.log(`[J41 ${t.name}] scrolling 2,000 rows: mean ${f.mean.toFixed(1)} ms, p95 ${f.p95.toFixed(1)} ms over ${f.n} frames, ${f.distance} px travelled`)
  if (t.name === 'studio') expect(f.p95, 'F11: scroll at 60 fps (p95 frame)').toBeLessThan(20)

  // bulk-0042 is past the 2,000 newest the list holds: search must still find it.
  await page.getByPlaceholder('Search list').fill('Bulk item 0042')
  await expect(t.listItem(page, 'bulk-0042')).toBeVisible({timeout: 10_000})
  const open = await timeToReady(page, t.listItem(page, 'bulk-0042'), `() => document.querySelector('[id="title"]')?.value === 'Bulk item 0042'`, null)
  await info.attach('scale-metrics.json', {body: JSON.stringify({scroll: f, open}), contentType: 'application/json'})
  if (t.name === 'studio') expect(open.ms, 'F2: open from a big list').toBeLessThan(100)
})
