import {expect, test, type Page} from '../rig/test'
import {target} from '../rig/targets'

// Split from live.spec for CI's shards (task-c1df532bed870536).

// Over HTTP/1.1 (how `pnpm serve` answers) Chrome gives the studio 6 connections across
// all its tabs (task-a346be1998fb2f16). One stream per tab (lib/stream.ts): four visible tabs
// hold four, and a save from the fourth goes out (with two streams a tab, none did). A tab
// hidden a while lets its stream go (lib/hidden.ts): with three hidden, two more tabs open and
// a save from the sixth goes out too; shown again, a hidden tab catches up.
test('live: many tabs: four visible save, three hidden let go, six still save, a hidden one catches up', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our streams; Sanity talks HTTP/2 to its API')
  test.setTimeout(30_000)
  const ID = 'post-21'
  const TITLE = 'Fixture post 21'
  await context.addInitScript(() => ((window as {__hiddenReleaseMs?: number}).__hiddenReleaseMs = 300))
  // Headless tabs are all visible: a background tab, as the page sees one.
  const hide = (p: Page, hidden: boolean) =>
    p.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (h ? 'hidden' : 'visible')})
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => h})
      document.dispatchEvent(new Event('visibilitychange'))
    }, hidden)
  const open = (n: number) =>
    Promise.all(
      Array.from({length: n}, async () => {
        const p = await context.newPage()
        await p.goto(t.docPath('post', ID))
        await t.settle(p)
        return p
      }),
    )
  const type = async (p: Page, words: string) => {
    await t.field(p, 'title').click()
    await p.keyboard.press('End')
    await p.keyboard.type(words)
  }
  try {
    const tabs = await open(4)
    await type(tabs[3]!, ' four')
    await expect.poll(() => t.docValue(ID, 'title'), {timeout: 10_000, message: 'four visible tabs: the save reached the server'}).toBe(`${TITLE} four`)
    await expect(t.field(tabs[0]!, 'title'), 'and the first tab, live').toHaveValue(`${TITLE} four`, {timeout: 5_000})
    // Each hidden tab lets go: its stream closed (lib/stream.ts, __hiddenReleaseMs after it hides).
    await Promise.all(
      tabs.slice(0, 3).map(async (p) => {
        const gone = p.waitForEvent('requestfailed', (r) => new URL(r.url()).pathname.endsWith('/api/stream') && r.method() === 'GET')
        await hide(p, true)
        await gone
      }),
    )
    tabs.push(...(await open(2)))
    await type(tabs[5]!, ' six')
    await expect.poll(() => t.docValue(ID, 'title'), {timeout: 10_000, message: 'six tabs, three hidden: the save reached the server'}).toBe(`${TITLE} four six`)
    await hide(tabs[0]!, false)
    await expect(t.field(tabs[0]!, 'title'), 'shown again, a hidden tab catches up').toHaveValue(`${TITLE} four six`, {timeout: 5_000})
  } finally {
    await t.restore(ID, {title: TITLE})
  }
})
