import {expect, test} from '../rig/test'
import {target} from '../rig/targets'

// The live stream gone quiet, and the hub's own upstream cut or deaf, while another client
// writes: the missed write still comes. Split from live.spec for CI's shards
// (task-c1df532bed870536).
const ID = 'post-10'
const TITLE = 'Fixture post 10'

// A dropped network that sends no reset (a Wi-Fi switch, a sleep): the page's stream stays
// open and hears nothing, and a write never came (task-be55a4dfb930fd8c: 90 s and still
// stale, no "Trying to connect…"). The page now reopens a stream quiet past its pings.
test('live: a stream gone quiet without closing is reopened, and the missed write comes', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our listen stream')
  await page.clock.install() // the quiet is passed on the page's clock, not sat out
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await expect(t.field(page, 'title')).toHaveValue(TITLE)
  // The write's frame as it reaches the page's stream, muted or not (Chrome's network layer).
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  let heard = false
  cdp.on('Network.eventSourceMessageReceived', (e) => void (e.eventName === 'mutation' && e.data.includes(ID) && e.data.includes('while quiet') && (heard = true)))
  try {
    await page.evaluate(() => (window as {__muteLive?: (ms: number) => void}).__muteLive!(1500))
    await t.patch(ID, {title: `${TITLE} while quiet`})
    const by = Date.now() + 6_000 - 2_600 // the 6 s it had, less the jump: a late reopen is still late
    // Missed for real first: its frame came on the muted stream. Then past the quiet the page calls
    // dead (lib/stream.ts:153: its 1 s watchdog, the mute's 1.5 s): the reopen must resume past it.
    await expect.poll(() => heard, {message: 'the write\'s frame reached the muted stream', intervals: [25], timeout: 6_000}).toBe(true)
    await page.clock.fastForward(2_600)
    await expect(t.field(page, 'title'), 'reopened at its last frame').toHaveValue(`${TITLE} while quiet`, {timeout: Math.max(1, by - Date.now())})
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
