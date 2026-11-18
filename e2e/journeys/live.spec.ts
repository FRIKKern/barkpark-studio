import {expect, test, type Page} from '../rig/test'
import {bpMutate, target} from '../rig/targets'

// Live stream survives a network blip (task-c1b6d7ed2e05b73a, F8): offline while
// another client writes; on reconnect every frame arrives, in order, once. The CI
// suite cuts for 2 s to fit its budget; LIVE_OFFLINE_MS=10000 is the 10 s check.
// A stream gone quiet and the hub's upstream: live-hub.spec; many tabs: live-tabs.spec.
const OFFLINE_MS = Number(process.env.LIVE_OFFLINE_MS || 2000)
const ID = 'post-10'
const TITLE = 'Fixture post 10'

/**
 * The stream open, its server listening to `id`: the tab's one stream opened with it (its GET
 * answers once the hub has it, app/src/routes/api/stream.ts) or a POST added it to the open one.
 */
const listening = (page: Page, id: string) => {
  const open = page.waitForResponse((r) => {
    if (!new URL(r.url()).pathname.endsWith('/api/stream')) return false
    const req = r.request()
    if (req.method() === 'GET') return (new URL(r.url()).searchParams.get('ids') ?? '').split(',').includes(id)
    try {
      return r.ok() && ((JSON.parse(req.postData() ?? '{}') as {ids?: string[]}).ids ?? []).includes(id)
    } catch {
      return false
    }
  })
  open.catch(() => {}) // awaited by the test; one that fails first leaves it to its page's close
  return open
}

test('live: offline, then every missed frame in order, no duplicates', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our listen proxy; the Sanity side of F8 is J20')
  test.setTimeout(40_000)
  await context.addInitScript(() => ((window as {__liveFrames?: string[]}).__liveFrames = []))
  try {
    const open = listening(page, ID)
    await page.goto(t.docPath('post', ID))
    await t.settle(page)
    await open

    // Chrome's offline emulation keeps an open SSE stream alive, so cut it from the
    // page side (what a dead network does) and go offline as well. Frames are counted from
    // the cut: a spec before this one on the shard's server may still have its own writes
    // to this doc replayed into a new page (live-hub.spec cuts the hub's upstream and
    // restores this doc; a resume answers a moment back), which counted as 4 frames more.
    const cut = await page.evaluate((ms) => {
      const w = window as {__dropLive?: (ms: number) => void; __liveFrames?: string[]}
      const at = w.__liveFrames!.length
      w.__dropLive!(ms)
      return at
    }, OFFLINE_MS)
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
    const frames = await page.evaluate(([id, cut]) => (window as {__liveFrames?: string[]}).__liveFrames!.slice(cut).filter((f) => f.endsWith(`.${id}`) || f.endsWith(`|${id}`)).map((f) => Number(f.split('|')[0])), [ID, cut] as const)
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
