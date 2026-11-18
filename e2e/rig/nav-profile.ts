import type {BrowserContext} from '@playwright/test'

// Temporary (task-c1df532bed870536): each document load's timing, printed when the page is
// hydrated: where a CI page.goto's time goes (server, transfer, scripts, hydration).
const BINDING = '__e2eNavProfile'
const watch = (binding: string) => {
  const send = () => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (!n) return
    const r = (v: number) => Math.round(v)
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const js = res.filter((e) => e.initiatorType === 'script' || /\.js(\?|$)/.test(e.name))
    void (window as unknown as Record<string, (t: string) => void>)[binding]?.(
      JSON.stringify({
        path: location.pathname + location.search,
        req: r(n.requestStart),
        ttfb: r(n.responseStart),
        resEnd: r(n.responseEnd),
        domInt: r(n.domInteractive),
        dcl: r(n.domContentLoadedEventEnd),
        load: r(n.loadEventEnd),
        hyd: r(performance.now()),
        bytes: n.transferSize,
        js: js.length,
        jsEnd: r(Math.max(0, ...js.map((e) => e.responseEnd))),
      }),
    )
  }
  const look = () => {
    if (!document.documentElement?.hasAttribute('data-hydrated')) return false
    send()
    return true
  }
  const start = () => {
    if (look()) return
    const mo = new MutationObserver(() => look() && mo.disconnect())
    mo.observe(document.documentElement, {attributes: true, attributeFilter: ['data-hydrated']})
  }
  if (document.documentElement) start()
  else document.addEventListener('DOMContentLoaded', start)
}

export async function navProfile(c: BrowserContext, spec: () => string) {
  if (!process.env.CI) return
  await c.exposeBinding(BINDING, (_src, text: string) => console.log(`NAV ${spec()} ${text}`))
  await c.addInitScript(watch, BINDING)
}
