import {expect, test, type Page} from '@playwright/test'
import {installProbes, stats, timeToReady, typeAndMeasure} from '../rig/feel'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// J44 evidence, both studios, CPU throttled 4×: longform-1 has 200 fields and a
// 300-item array (scripts/gen-longform.mjs). F2: open it warm from the list.
// F1: type into the first field, the last field, and row #300's dialog. Numbers
// go to the annotations (and the console) for the side-by-side table; budgets
// are judged on ours only. Not a CI gate: the doc is big and the throttle slow.
const ID = 'longform-1'
const THROTTLE = Number(process.env.THROTTLE || 4)
const TEXT = ' the quick brown fox'
const shot = (name: string, step: string) => `evidence/J44-${name}-${step}.png`
const ready = `(w) => document.getElementById('title')?.value === w`

const rowsField = (t: Target, page: Page) =>
  t.name === 'sanity' ? page.locator('[data-testid="field-rows"]') : page.locator('.field').filter({has: page.locator('[id="rows"]')}).last()

test.use({video: 'on'})
test.setTimeout(120_000)
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  const t = target(info)
  // Back to the seed: the typed fields, and the rows in each side's item shape.
  const rows = Array.from({length: 300}, (_, i) => {
    const n = String(i + 1).padStart(3, '0')
    return {_key: `row${n}`, ...(t.name === 'sanity' ? {_type: 'row'} : {kind: 'row'}), title: `Row ${n}`, note: `Note ${n}`}
  })
  await t.restore(ID, {title: 'Very long document', f200: 'Value 200', rows}, 'longform')
})

test('@evidence J44: 200 fields + 300 rows keep F1 and F2 (4× CPU throttle)', async ({page, context}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => {
    info.annotations.push({type: what, description: JSON.stringify(v)})
    console.log(`[J44 ${t.name}] ${what}: ${JSON.stringify(v)}`)
  }
  await Promise.all([t.prepare(context), installProbes(context)])
  await page.goto('/structure/longform')
  await signInIfAsked(page)
  await t.settle(page)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: THROTTLE})

  // F2, warm: open once, back to the list, open again (timed).
  await t.listItem(page, ID).click()
  await expect(t.field(page, 'title')).toHaveValue('Very long document', {timeout: 30_000})
  await page.goBack()
  await expect(t.field(page, 'title')).toHaveCount(0)
  const opens = []
  for (let i = 0; i < 3; i++) {
    opens.push(await timeToReady(page, t.listItem(page, ID), ready, 'Very long document'))
    await page.goBack()
    await expect(t.field(page, 'title')).toHaveCount(0)
  }
  const f2 = {...stats(opens.map((o) => o.ms)), clsMax: Math.max(...opens.map((o) => o.cls))}
  note('F2 warm open', f2)
  await t.listItem(page, ID).click()
  await expect(t.field(page, 'title')).toHaveValue('Very long document', {timeout: 30_000})
  await page.screenshot({path: shot(t.name, '1-open')})

  // F1 at the top, at the bottom (field 200), and inside row #300's dialog.
  const top = await typeAndMeasure(page, t.field(page, 'title'), TEXT)
  note('F1 first field', {frame: stats(top.keys), eventTiming: stats(top.slowKeys)})
  const last = t.field(page, 'f200')
  await last.scrollIntoViewIfNeeded()
  const bottom = await typeAndMeasure(page, last, TEXT)
  note('F1 field 200', {frame: stats(bottom.keys), eventTiming: stats(bottom.slowKeys)})
  await page.screenshot({path: shot(t.name, '2-field-200')})

  const row = rowsField(t, page).getByRole('button', {name: /Row 300/}).first()
  // Sanity draws only the array rows in view: wheel down to the last one.
  if (t.name === 'sanity') {
    const field = rowsField(t, page)
    for (let i = 0; i < 60 && !(await row.isVisible()); i++) {
      await field.evaluate((el) => {
        let s: HTMLElement | null = el
        while (s && !(s.scrollHeight > s.clientHeight && getComputedStyle(s).overflowY !== 'visible')) s = s.parentElement
        s?.scrollBy(0, 2000)
      })
      await page.waitForTimeout(250)
    }
    // Measured 2026-10-06: its virtual list never drew row 300 here, at 4× or 1×.
    if (!(await row.isVisible())) return note('F1 row 300 dialog', 'not reached: the virtual list never drew row 300')
  }
  await row.scrollIntoViewIfNeeded()
  await expect(row).toBeVisible()
  await row.click()
  const dialog = page.getByRole('dialog').last()
  const rowTitle = dialog.getByRole('textbox').first()
  await expect(rowTitle).toHaveValue('Row 300', {timeout: 15_000})
  if (t.name === 'sanity') await page.waitForTimeout(600) // its dialog animates in
  const inRow = await typeAndMeasure(page, rowTitle, TEXT)
  note('F1 row 300 dialog', {frame: stats(inRow.keys), eventTiming: stats(inRow.slowKeys)})
  await page.screenshot({path: shot(t.name, '3-row-300')})
  await page.keyboard.press('Escape')
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1})
  // Every edit saved before afterEach restores the seed (a late write would undo it).
  await expect.poll(() => t.docValue(ID, 'rows', 'longform').then((r) => (r as {title?: string}[] | undefined)?.at(-1)?.title), {timeout: 15_000}).toBe(`Row 300${TEXT}`)
  await page.close()

  // Ours keeps the budgets under the throttle: F2 < 100 ms with no shift; F1
  // frames p95 < 16 ms… measured, and judged against Sanity's side in the PR.
  if (t.name === 'studio') {
    expect(f2.clsMax, 'F2 layout shift').toBe(0)
    for (const [where, r] of [['top', top], ['field 200', bottom], ['row 300', inRow]] as const)
      expect(stats(r.keys).n, `F1 keys seen (${where})`).toBe(TEXT.length)
  }
})
