import {expect, test} from '@playwright/test'
import {bpMutate, target} from '../rig/targets'

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
// one, alive and deaf, until it closes (de6987a, 2026-10-09: ~25 s without frames).
test('@local live: a deploy leaves the stream deaf; a new instance re-opens it and the missed frames come', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our listen hub')
  await context.addInitScript(() => ((window as {__liveFrames?: string[]}).__liveFrames = []))
  const framesFor = () => page.evaluate((id) => (window as {__liveFrames?: string[]}).__liveFrames!.filter((f) => f.endsWith(`.${id}`) || f.endsWith(`|${id}`)).length, ID)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await expect(t.field(page, 'title')).toHaveValue(TITLE)
  try {
    await lever(page, 'deaf')
    const before = await framesFor()
    await t.patch(ID, {title: `${TITLE} after the flip`})
    await page.waitForTimeout(1500)
    expect(await framesFor(), 'deaf: no frame arrives').toBe(before)
    await lever(page, 'flip')
    await expect.poll(framesFor, {timeout: 8_000}).toBeGreaterThan(before)
    await expect(t.field(page, 'title')).toHaveValue(`${TITLE} after the flip`)
  } finally {
    await t.restore(ID, {title: TITLE})
  }
})
