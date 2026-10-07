import type {BrowserContext, Locator, Page} from '@playwright/test'

// In-page probes for the QUALITY.md feel rows. Installed before any page script runs.
//  F1  keydown → the frame after it painted (rAF + message = after paint), per key,
//      plus Event Timing keydown durations (the browser's own input→paint; it only
//      reports entries ≥ 16 ms, so fewer entries than keys means some were faster).
//  F2  layout shifts (CLS) collected continuously; timeToReady() reads its window.
declare global {
  interface Window {
    __feel: {keys: number[]; slowKeys: number[]; shifts: {t: number; v: number; src: string}[]}
  }
}

export async function installProbes(ctx: BrowserContext) {
  await ctx.addInitScript(() => {
    const feel = (window.__feel = {keys: [] as number[], slowKeys: [] as number[], shifts: [] as {t: number; v: number; src: string}[]})
    addEventListener(
      'keydown',
      (e) => {
        const t = e.timeStamp
        requestAnimationFrame(() => {
          const ch = new MessageChannel()
          ch.port1.onmessage = () => feel.keys.push(performance.now() - t)
          ch.port2.postMessage(0)
        })
      },
      true,
    )
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === 'keydown') feel.slowKeys.push(e.duration)
    }).observe({type: 'event', durationThreshold: 16, buffered: true} as PerformanceObserverInit)
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as (PerformanceEntry & {value: number; hadRecentInput: boolean; sources?: {node?: Node}[]})[]) {
        if (e.hadRecentInput) continue
        // Name what moved, so a CLS failure says where to look.
        const src = (e.sources ?? []).map(({node}) => {
          const el = node instanceof Element ? node : node?.parentElement
          return el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}` : '?'
        })
        feel.shifts.push({t: e.startTime, v: e.value, src: src.join(' ')})
      }
    }).observe({type: 'layout-shift', buffered: true})
  })
}

export const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] ?? NaN)
  return {n: s.length, p50: q(0.5), p95: q(0.95), max: q(1)}
}

/** F1: type `text` into `field` like a person (60 ms between keys); per-key input→paint ms. */
export async function typeAndMeasure(page: Page, field: Locator, text: string) {
  await field.click()
  await page.evaluate(() => ((window.__feel.keys = []), (window.__feel.slowKeys = [])))
  await page.keyboard.type(text, {delay: 60})
  await page.waitForTimeout(100)
  return page.evaluate(() => ({keys: window.__feel.keys, slowKeys: window.__feel.slowKeys}))
}

/**
 * F2: click `item` with a real (trusted) click, then time from that click's event
 * to the first frame where `ready` holds. A trusted click matters: layout that
 * moves because the user clicked is not a layout shift (hadRecentInput), and a
 * synthetic el.click() would make it look like one. Returns ms and CLS after it.
 */
export async function timeToReady(page: Page, item: Locator, ready: string, arg: unknown, settleMs = 300) {
  await page.evaluate(() => {
    const w = window as {__clickAt?: number}
    delete w.__clickAt
    addEventListener('click', (e) => (w.__clickAt = e.timeStamp), {capture: true, once: true})
  })
  await item.click()
  return page.evaluate(
    async ({ready, arg, settleMs}) => {
      const done = new Function('arg', `return (${ready})(arg)`) as (a: unknown) => boolean
      const w = window as {__clickAt?: number}
      const start = performance.now()
      while (!done(arg)) {
        await new Promise(requestAnimationFrame)
        if (performance.now() - start > 10_000) throw new Error('timeToReady: never ready')
      }
      const t0 = w.__clickAt ?? start
      const ms = performance.now() - t0
      if (settleMs) await new Promise((r) => setTimeout(r, settleMs)) // let late shifts land
      const shifts = window.__feel.shifts.filter((s) => s.t >= t0)
      return {ms, cls: shifts.reduce((a, s) => a + s.v, 0), shifted: shifts.map((s) => s.src).join(' | ')}
    },
    {ready, arg, settleMs},
  )
}

/**
 * F4: resolve with the wall-clock ms (Date.now scale) at the first frame where
 * the field at `selector` has `value`. Start it BEFORE the write, then await it.
 */
export function seenAt(page: Page, selector: string, value: string): Promise<number> {
  return page.evaluate(
    async ({selector, value}) => {
      const t0 = performance.now()
      for (;;) {
        const el = document.querySelector(selector) as HTMLInputElement | null
        if (el?.value === value) return performance.timeOrigin + performance.now()
        await new Promise(requestAnimationFrame)
        if (performance.now() - t0 > 10_000) throw new Error(`seenAt: ${selector} never became ${value}`)
      }
    },
    {selector, value},
  )
}

/**
 * A budget that crosses the network to Barkpark (F3 cold load, F4 remote edit).
 * QUALITY.md budgets are for a local machine near the server; CI runs far from it
 * and sets BUDGET_NETWORK_SCALE to stretch them. In-browser budgets (F1, F2) don't scale.
 */
export const networkBudget = (ms: number) => ms * Number(process.env.BUDGET_NETWORK_SCALE || 1)
