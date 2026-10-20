import {expect, test, type Page} from '@playwright/test'
import {BACKEND_POLL, bpMutate, target} from '../rig/targets'

// Live stream survives a network blip (task-c1b6d7ed2e05b73a, F8): offline while
// another client writes; on reconnect every frame arrives, in order, once. The CI
// suite cuts for 2 s to fit its budget; LIVE_OFFLINE_MS=10000 is the 10 s check.
const OFFLINE_MS = Number(process.env.LIVE_OFFLINE_MS || 2000)
const ID = 'post-10'
const TITLE = 'Fixture post 10'

test('live: offline, then every missed frame in order, no duplicates', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our listen proxy; the Sanity side of F8 is J20')
  test.setTimeout(40_000)
  await context.addInitScript(() => ((window as {__liveFrames?: string[]}).__liveFrames = []))
  try {
    await page.goto(t.docPath('post', ID))
    await t.settle(page)
    await page.waitForTimeout(500) // stream open

    // Chrome's offline emulation keeps an open SSE stream alive, so cut it from the
    // page side (what a dead network does) and go offline as well.
    await page.evaluate((ms) => (window as {__dropLive?: (ms: number) => void}).__dropLive!(ms), OFFLINE_MS)
    await context.setOffline(true)
    for (const n of [1, 2, 3]) {
      await t.patch(ID, {title: `${TITLE} offline ${n}`})
      await page.waitForTimeout((OFFLINE_MS - 1000) / 3)
    }
    await expect(t.field(page, 'title'), 'nothing arrives while cut').toHaveValue(TITLE)
    await context.setOffline(false)

    await expect(t.field(page, 'title')).toHaveValue(`${TITLE} offline 3`, {timeout: 10_000})
    await page.waitForTimeout(500)
    // Only this doc's frames: the page also listens to its type, and the dataset is shared.
    const frames = await page.evaluate((id) => (window as {__liveFrames?: string[]}).__liveFrames!.filter((f) => f.endsWith(`.${id}`) || f.endsWith(`|${id}`)).map((f) => Number(f.split('|')[0])), ID)
    expect(frames.length, 'patch + publish per write: 6 frames').toBe(6)
    expect(new Set(frames).size, 'no duplicates').toBe(frames.length)
    expect([...frames].sort((a, b) => a - b), 'in order').toEqual(frames)
  } finally {
    await context.setOffline(false)
    await t.restore(ID, {title: TITLE})
  }
})

// A draft discarded elsewhere goes here too. Barkpark's discardDraft frame carries the
// draft it removed; applied as the new state, it put the dead draft back on screen (the
// J36 flake, 2026-10-09). Ours only: the frame shape is Barkpark's.
test('live: a draft discarded elsewhere leaves the open document', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark frames')
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await expect(t.field(page, 'title')).toHaveValue(TITLE)
  try {
    await bpMutate([{patch: {id: ID, type: 'post', set: {title: `${TITLE} elsewhere`}}}])
    await expect(t.field(page, 'title')).toHaveValue(`${TITLE} elsewhere`)
    await bpMutate([{discardDraft: {id: ID, type: 'post'}}])
    await expect(t.field(page, 'title')).toHaveValue(TITLE)
  } finally {
    await bpMutate([{discardDraft: {id: ID, type: 'post'}}]).catch(() => {})
  }
})


// A dropped network that sends no reset (a Wi-Fi switch, a sleep): the page's stream stays
// open and hears nothing, and a write never came (task-be55a4dfb930fd8c: 90 s and still
// stale, no "Trying to connect…"). The page now reopens a stream quiet past its pings.
test('live: a stream gone quiet without closing is reopened, and the missed write comes', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our listen stream')
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await expect(t.field(page, 'title')).toHaveValue(TITLE)
  try {
    await page.evaluate(() => (window as {__muteLive?: (ms: number) => void}).__muteLive!(1500))
    await t.patch(ID, {title: `${TITLE} while quiet`})
    await expect(t.field(page, 'title'), 'reopened at its last frame').toHaveValue(`${TITLE} while quiet`, {timeout: 6_000})
  } finally {
    await t.restore(ID, {title: TITLE})
  }
})

// The hub's own upstream (server/listen.ts), cut or gone deaf while another client writes.
// Levers: POST /api/e2e-listen (the studio server runs with STUDIO_E2E_HOOKS=1).
const lever = (page: import('@playwright/test').Page, action: 'deaf' | 'cut' | 'flip', ms?: number) =>
  page.request.post('/api/e2e-listen', {data: {action, ms}}).then((r) => expect(r.ok(), `lever ${action}`).toBe(true))

test('live: the upstream cut mid-write; the hub resumes at its last frame and nothing is lost', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our listen hub')
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await expect(t.field(page, 'title')).toHaveValue(TITLE)
  try {
    await lever(page, 'cut', 1500)
    await t.patch(ID, {title: `${TITLE} in the gap`})
    await expect(t.field(page, 'title'), 'replayed from Last-Event-ID').toHaveValue(`${TITLE} in the gap`, {timeout: 6_000})
  } finally {
    await t.restore(ID, {title: TITLE})
  }
})

// A Barkpark deploy flips Caddy to a new instance; a stream opened before stays on the old
// one, alive and deaf, until it closes (de6987a, 2026-10-09: ~25 s without frames). The
// re-open resumes at the hub's last event id (Barkpark replays the gap) or, with none yet
// (no frame since it connected, as on a fresh server here), tells the page to read again.
test('@local live: a deploy leaves the stream deaf; a new instance re-opens it and the missed change comes', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our listen hub')
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await expect(t.field(page, 'title')).toHaveValue(TITLE)
  // Deaf is the whole server's: a run that fails before the flip leaves every later live
  // test on it deaf too (they failed in a row after one did). The flip always comes.
  let flipped = false
  try {
    await lever(page, 'deaf')
    await t.patch(ID, {title: `${TITLE} after the flip`})
    await page.waitForTimeout(1500)
    // What the page shows, not a count of frames: the test before restores this doc, and
    // its frames may still be replayed into this page's stream (a resume answers a moment
    // back), which counted as frames heard while deaf.
    await expect(t.field(page, 'title'), 'deaf: the change does not arrive').toHaveValue(TITLE)
    await lever(page, 'flip')
    flipped = true
    await expect(t.field(page, 'title')).toHaveValue(`${TITLE} after the flip`, {timeout: 8_000})
  } finally {
    if (!flipped) await lever(page, 'flip').catch(() => {})
    await t.restore(ID, {title: TITLE})
  }
})

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
    await expect.poll(() => t.docValue(ID, 'title'), {...BACKEND_POLL, timeout: 10_000, message: 'four visible tabs: the save reached the server'}).toBe(`${TITLE} four`)
    await expect(t.field(tabs[0]!, 'title'), 'and the first tab, live').toHaveValue(`${TITLE} four`, {timeout: 5_000})
    for (const p of tabs.slice(0, 3)) await hide(p, true)
    await tabs[3]!.waitForTimeout(600)
    tabs.push(...(await open(2)))
    await type(tabs[5]!, ' six')
    await expect.poll(() => t.docValue(ID, 'title'), {...BACKEND_POLL, timeout: 10_000, message: 'six tabs, three hidden: the save reached the server'}).toBe(`${TITLE} four six`)
    await hide(tabs[0]!, false)
    await expect(t.field(tabs[0]!, 'title'), 'shown again, a hidden tab catches up').toHaveValue(`${TITLE} four six`, {timeout: 5_000})
  } finally {
    await t.restore(ID, {title: TITLE})
  }
})
