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
  // From the list (role=list), not a row: the rows near the view are drawn as it scrolls, so a row may be gone.
  const position = () => page.locator('[role="list"]').filter({has: page.locator('a[href^="/structure/bulk;"]')}).first().evaluate((list) => {
    for (let el = list.parentElement; el; el = el.parentElement)
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
  // seed-bulk.mjs seeds only e2e-local and e2e-local-*: another lane's dataset has no bulk docs.
  test.skip(!/^e2e-local(-|$)/.test(process.env.BARKPARK_DATASET ?? 'e2e-local'), 'no bulk docs in this dataset (scripts/seed-bulk.mjs)')
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
  // F11 while it grows: the rows from 100 to 2,000 mount a few at a time, never one long frame.
  await page.evaluate(() => {
    const w = window as {__grow?: number[]; __growing?: boolean}
    w.__grow = []
    w.__growing = true
    let last = performance.now()
    const tick = (t: number) => (w.__grow!.push(t - last), (last = t), w.__growing && requestAnimationFrame(tick))
    requestAnimationFrame(tick)
  })
  for (let i = 0; i < 400 && !(await atEnd()); i++) await page.mouse.wheel(0, 3000)
  await expect(note).toBeInViewport()
  const worstGrowing = await page.evaluate(() => {
    const w = window as {__grow?: number[]; __growing?: boolean}
    w.__growing = false
    return Math.max(...w.__grow!.slice(1))
  })
  console.log(`[J41 ${t.name}] growing to 2,000 rows: worst frame ${worstGrowing.toFixed(0)} ms`)
  if (t.name === 'studio') expect(worstGrowing, 'F11: growing to 2,000 never stalls a frame').toBeLessThan(100)

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

// A new sort of a longer list than is loaded: the old order stays until the server's
// answer, never the loaded page sorted on the client (it read "Bulk item 0100" for a
// moment under Sort by Created).
test('@local J41: a new sort shows no wrongly ordered first page meanwhile', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity shows its loading rows instead")
  await t.prepare(page.context())
  await page.goto('/structure/bulk')
  const first = page.locator('a[href^="/structure/bulk;"]').first()
  await first.waitFor()
  const menu = page.getByRole('button', {name: 'List options'}).first()
  try {
    for (const [sort, want] of [['Sort by Title', 'Bulk item 0001'], ['Sort by Created', 'Bulk item 5000']] as const) {
      const before = (await first.textContent())!.trim()
      await menu.click()
      await page.getByText(sort).first().click()
      const seen = new Set<string>()
      for (let i = 0; i < 40 && !seen.has(want); i++) seen.add((await first.textContent())!.trim()), await page.waitForTimeout(25)
      expect([...seen].filter((s) => s !== before && s !== want), `${sort}: only the old first row, then the new one`).toEqual([])
      await expect(first).toHaveText(want)
    }
  } finally {
    await menu.click()
    await page.getByText('Default sort').first().click()
  }
})

// B03 on a long list, which draws only the rows near the view (RowWindow): a Shift-click
// range runs over rows that aren't drawn, the ticks outlast scrolling away and back, and
// Publish selected takes every ticked doc, drawn or not. Ticks stop at MAX_SELECTED (500).
test('@local J41 B03: a range ticked across rows not drawn is kept and published whole', async ({page}, info) => {
  test.setTimeout(90_000)
  test.skip(!/^e2e-local(-|$)/.test(process.env.BARKPARK_DATASET ?? 'e2e-local'), 'no bulk docs in this dataset (scripts/seed-bulk.mjs)')
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: Sanity has no bulk actions')
  // Two docs get a draft with the published title (publishing it changes nothing); edited last, they lead the list.
  const DRAFTED = ['bulk-2500', 'bulk-2501']
  const mutate = (mutations: unknown[]) => fetch(`${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/data/mutate/${process.env.BARKPARK_DATASET}`, {method: 'POST', headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`, 'content-type': 'application/json'}, body: JSON.stringify({mutations})})
  for (const id of DRAFTED) await mutate([{patch: {id, type: 'bulk', set: {title: `Bulk item ${id.slice(5)}`}}}])
  try {
    await t.prepare(page.context())
    await page.goto(t.listPath('bulk'))
    await t.settle(page)
    const rows = 'a[href^="/structure/bulk;"]'
    await page.locator(rows).first().waitFor()
    const at = (n: number) => page.locator(`[role="listitem"][aria-posinset="${n}"]`)
    // Scroll the list until row n is drawn (down, or up with a negative step).
    const list = page.locator('.list-rows').filter({has: page.locator(rows)}).first()
    const reach = async (n: number, step: number) => {
      for (let i = 0; i < 300 && !(await at(n).count()); i++) await list.evaluate((el, step) => el.scrollBy(0, step), step), await page.waitForTimeout(16)
      await at(n).scrollIntoViewIfNeeded()
    }
    await reach(1900, 3000) // grows to 2,000 on the way
    await reach(1, -3000)
    await page.getByRole('button', {name: 'List options'}).first().click()
    await page.getByRole('menuitemradio', {name: 'Select documents'}).click()
    await at(1).getByRole('checkbox').check()
    await reach(400, 3000)
    await expect(at(1)).toHaveCount(0) // not drawn now
    await at(400).locator(rows).click({modifiers: ['Shift']})
    const bar = page.getByRole('region', {name: 'Bulk actions'})
    await expect(bar.getByRole('status')).toHaveText('400 selected')
    await reach(1, -3000)
    for (const n of [1, 2, 3]) await expect(at(n).getByRole('checkbox')).toBeChecked()
    await bar.getByRole('button', {name: 'Publish selected', exact: true}).click()
    await expect(page.locator('.toast').last()).toContainText('Published 2 of 400', {timeout: 30_000})
    await expect(page.locator('.toast').last()).toContainText('398 had no changes to publish.')
    const draft = (id: string) => fetch(`${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/data/doc/${process.env.BARKPARK_DATASET}/bulk/${id}?perspective=drafts`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}}).then(async (r) => !!((await r.json()) as {result?: {_draft?: boolean}}).result?._draft)
    for (const id of DRAFTED) expect(await draft(id), `${id}: published, no draft left`).toBe(false)
    // A range longer than MAX_SELECTED stops there, as on a short list.
    await page.getByRole('button', {name: 'List options'}).first().click()
    await page.getByRole('menuitemradio', {name: 'Select documents'}).click()
    await at(1).getByRole('checkbox').check()
    await reach(1900, 3000)
    await at(1900).locator(rows).click({modifiers: ['Shift']})
    await expect(bar.getByRole('status')).toHaveText('500 selected')
  } finally {
    for (const id of DRAFTED) await t.restore(id, {title: `Bulk item ${id.slice(5)}`}, 'bulk')
  }
})
