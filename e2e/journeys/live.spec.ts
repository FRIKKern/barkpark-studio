import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// Live stream survives a network blip (task-c1b6d7ed2e05b73a, F8): offline while
// another client writes; on reconnect every frame arrives, in order, once. The CI
// suite cuts for 4 s to fit its 60 s budget; LIVE_OFFLINE_MS=10000 is the 10 s check.
const OFFLINE_MS = Number(process.env.LIVE_OFFLINE_MS || 4000)
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
