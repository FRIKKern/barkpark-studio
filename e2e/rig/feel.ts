import type {BrowserContext, Locator, Page} from '@playwright/test'

// In-page probes for the QUALITY.md feel rows. Installed before any page script runs.
//  F1  keydown → the frame after it painted (rAF + message = after paint), per key,
//      plus Event Timing keydown durations (the browser's own input→paint; it only
//      reports entries ≥ 16 ms, so fewer entries than keys means some were faster).
//  F2  layout shifts (CLS) collected continuously; timeToReady() reads its window.
declare global {
  interface Window {
    __feel: {keys: number[]; slowKeys: number[]; shifts: {t: number; v: number}[]}
  }
}

export async function installProbes(ctx: BrowserContext) {
  await ctx.addInitScript(() => {
    const feel = (window.__feel = {keys: [] as number[], slowKeys: [] as number[], shifts: [] as {t: number; v: number}[]})
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
      for (const e of l.getEntries() as (PerformanceEntry & {value: number; hadRecentInput: boolean})[])
        if (!e.hadRecentInput) feel.shifts.push({t: e.startTime, v: e.value})
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
 * F2: click `item`, then time until `ready` holds in the page (polled every frame).
 * Returns ms from the click to the first frame where it holds, and CLS in that window.
 */
export async function timeToReady(page: Page, item: Locator, ready: string, arg: unknown) {
  const handle = await item.elementHandle()
  return page.evaluate(
    async ({el, ready, arg}) => {
      const done = new Function('arg', `return (${ready})(arg)`) as (a: unknown) => boolean
      const t0 = performance.now()
      ;(el as HTMLElement).click()
      while (!done(arg)) {
        await new Promise(requestAnimationFrame)
        if (performance.now() - t0 > 10_000) throw new Error('timeToReady: never ready')
      }
      const ms = performance.now() - t0
      await new Promise((r) => setTimeout(r, 300)) // let late shifts land
      const cls = window.__feel.shifts.filter((s) => s.t >= t0).reduce((a, s) => a + s.v, 0)
      return {ms, cls}
    },
    {el: handle, ready, arg},
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
