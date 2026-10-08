import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J51 evidence, both studios, on Fast 3G (Chrome's preset: 562.5 ms RTT, 1.44 Mbps
// down): cold open of the post list, then open Author, then a doc. Per step it notes
// when the pane first shows anything (its loading state) and when it holds content;
// F14 wants the shell < 2 s and a loading state < 300 ms after every click. Run on
// production builds: E2E_PROD=1 (ours), SANITY_PORT=3334 on `sanity build && sanity
// preview` (Sanity's dev server ships hundreds of unbundled modules). Stills of each
// pane 300 ms after its click (and the list's skeleton at 450) in e2e/evidence/J51-*.
const FAST_3G = {offline: false, latency: 562.5, downloadThroughput: (1.44e6 / 8) * 0.9, uploadThroughput: (675e3 / 8) * 0.9}
const shot = (name: string, step: string) => `evidence/J51-${step}-${name}.png`
test.setTimeout(180_000)

/** Click, then ms (click → each predicate first true), polled every frame in the page. */
async function clickAndTime(page: Page, click: () => Promise<void>, checks: Record<string, string>) {
  const watch = page.evaluate(
    (checks) =>
      new Promise<Record<string, number>>((resolve) => {
        const out: Record<string, number> = {}
        let t0 = 0
        addEventListener('pointerdown', () => (t0 = performance.now()), {once: true, capture: true})
        const tick = () => {
          if (t0) for (const [k, src] of Object.entries(checks)) if (!(k in out) && new Function(`return (${src})`)()) out[k] = Math.round(performance.now() - t0)
          if (Object.keys(out).length === Object.keys(checks).length) resolve(out)
          else requestAnimationFrame(tick)
        }
        tick()
      }),
    checks,
  )
  await click()
  return watch
}

const visible = (sel: string) => `[...document.querySelectorAll(${JSON.stringify(sel)})].some((e) => e.getBoundingClientRect().height > 0)`

test('@evidence J51: Fast 3G — shell, then a loading state in every pane, never a dead click', async ({page, context}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => (info.annotations.push({type: what, description: JSON.stringify(v)}), console.log(`[J51 ${t.name}] ${what}: ${JSON.stringify(v)}`))
  await t.prepare(context)
  // Sign in (ours, dev login) and let the studio's own caches fill, unthrottled; the
  // cold open below starts with an empty HTTP cache in a fresh page.
  await page.goto('/structure')
  await signInIfAsked(page)
  const cold = await context.newPage()
  await page.close()
  const cdp = await context.newCDPSession(cold)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true})
  await cdp.send('Network.emulateNetworkConditions', FAST_3G)
  await cold.addInitScript((checks) => {
    const w = window as unknown as {__cold: Record<string, number>}
    w.__cold = {}
    const tick = () => {
      for (const [k, src] of Object.entries(checks)) if (!(k in w.__cold) && document.body && new Function(`return (${src})`)()) w.__cold[k] = Math.round(performance.now())
      if (Object.keys(w.__cold).length < Object.keys(checks).length) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, {hydrated: `document.documentElement.hasAttribute('data-hydrated')`, navbar: visible('header, [data-ui="Navbar"], [data-testid="navbar"]'), listPane: visible('[data-pane-index="1"]'), rows: visible('a[href*="/structure/post;"]')})

  // 1. Cold open of the post list.
  await cold.goto(t.listPath('post'), {waitUntil: 'commit'})
  await expect(cold.locator('a[href*="/structure/post;"]').first()).toBeVisible({timeout: 60_000})
  const fcp = await cold.evaluate(() => Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN))
  note('cold open (ms from navigation)', {fcp, ...(await cold.evaluate(() => (window as unknown as {__cold: object}).__cold))})
  await cold.screenshot({path: shot(t.name, '1-cold')})
  // A button clicked as soon as it shows (ours: before hydration, held and replayed).
  const menu = t.listMenu(t.pane(cold, 1))
  await menu.click()
  const clickedAt = await cold.evaluate(() => Math.round(performance.now()))
  await expect(cold.getByText('Sort by Last Edited')).toBeVisible({timeout: 30_000})
  note('list "…" clicked at first sight → menu open (ms from navigation)', {clickedAt, open: await cold.evaluate(() => Math.round(performance.now()))})
  await cold.keyboard.press('Escape')
  // Ours is server-rendered: its links work before hydration, as full page loads.
  // Clicks below are timed once the client runs (Sanity: as soon as it shows).
  await t.settle(cold)
  note('hydrated (ms from navigation)', await cold.evaluate(() => (window as unknown as {__cold: {hydrated?: number}}).__cold.hydrated ?? 'n/a (client-rendered)'))

  // 2. Open Author: the list pane shows (loading) and then rows.
  const author = cold.locator('[data-pane-index="0"] a[href="/structure/author"]')
  await author.waitFor()
  const step2 = clickAndTime(cold, () => author.click(), {
    selected: `document.querySelector('[data-pane-index="0"] a[href="/structure/author"]')?.matches('[aria-current="true"], [data-selected], [data-pressed], [data-selected="true"], [aria-pressed="true"]')`,
    pane: `[...document.querySelectorAll('[data-pane-index="1"]')].some((e) => /Author/.test(e.textContent ?? ''))`,
    rows: visible('a[href*="/structure/author;"]'),
  })
  await cold.waitForTimeout(300)
  await cold.screenshot({path: shot(t.name, '2-author-300ms')})
  await cold.waitForTimeout(150)
  await cold.screenshot({path: shot(t.name, '2-author-450ms')})
  note('open Author (ms from click)', await step2)

  // 3. Open a doc: the doc pane shows (loading) and then its fields.
  const ada = cold.locator('a[href$=";author-ada"]').first()
  const step3 = clickAndTime(cold, () => ada.click(), {
    pane: visible('[data-pane-index="2"]'),
    field: `!!document.querySelector('[data-pane-index="2"] [id="name"]')?.value`,
  })
  await cold.waitForTimeout(300)
  await cold.screenshot({path: shot(t.name, '3-doc-300ms')})
  note('open a doc (ms from click)', await step3)
  await cold.screenshot({path: shot(t.name, '4-doc-loaded')})
})
