// SCRATCH (not for main): J07's quiet row in three shapes, with B's stream traced by CDP, to read
// the cause of #1342's hosted failure. SHAPE=main (real time) | 1342 (jump after A's self) |
// armed (jump only once A's join frame has reached B's muted stream).
import {expect, test} from '../rig/test'
import {target} from '../rig/targets'

const SHAPE = '1342'
type Probe = {__presence?: {self: string | null; others: string[]}; __mutePresence?: (ms: number) => void}

test(`probe J07 quiet: ${SHAPE}`, async ({browser}, info) => {
  const t = target(info)
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  const t0 = Date.now()
  const log: string[] = []
  const at = () => ((Date.now() - t0) / 1000).toFixed(2)
  const cdp = await ctxB.newCDPSession(b)
  await cdp.send('Network.enable')
  let current = ''
  let mutedId = ''
  let aId = ''
  const mutedFrames: string[] = []
  const joinOnMuted = () => !!aId && mutedFrames.some((d) => d.includes(aId))
  const streams: string[] = []
  cdp.on('Network.requestWillBeSent', (e) => {
    if (!/\/api\/stream\?/.test(e.request.url) || e.request.method !== 'GET') return
    current = e.requestId
    streams.push(e.requestId)
    log.push(`${at()} B GET stream #${streams.length}${mutedId ? ' (after mute)' : ''}`)
  })
  cdp.on('Network.eventSourceMessageReceived', (e) => {
    if (e.eventName !== 'presence' && e.eventName !== 'session') return
    const n = streams.indexOf(e.requestId) + 1
    const hasA = !!aId && e.data.includes(aId)
    if (e.requestId === mutedId && e.eventName === 'presence') mutedFrames.push(e.data)
    log.push(`${at()} B ${e.eventName} on #${n}${e.requestId === mutedId ? ' (muted)' : ''}${e.eventName === 'presence' ? (aId ? (hasA ? ' with A' : ' without A') : ' (A unknown)') : ''}`)
  })
  try {
    if (SHAPE !== 'main') await b.clock.install()
    await b.goto(t.docPath('post', 'post-03'))
    await t.settle(b)
    await b.waitForFunction(() => !!(window as unknown as Probe).__presence?.self)
    mutedId = current
    await b.evaluate(() => (window as unknown as Probe).__mutePresence!(1500))
    log.push(`${at()} B muted (stream #${streams.indexOf(mutedId) + 1})`)
    await a.goto(t.docPath('post', 'post-03'))
    await t.settle(a)
    await a.waitForFunction(() => !!(window as unknown as Probe).__presence?.self)
    const id = await a.evaluate(() => (window as unknown as Probe).__presence!.self!)
    aId = id
    log.push(`${at()} A self known`)
    if (SHAPE === '1342') {
      await b.clock.fastForward(2_600)
      log.push(`${at()} jumped`)
    }
    if (SHAPE === 'armed') {
      // Armed: the quiet has begun once A's join reached B's muted stream; if B already
      // reopened by itself (its real clock ran past the quiet), there is nothing to jump.
      await expect.poll(() => joinOnMuted() || current !== mutedId, {intervals: [25], timeout: 8_000}).toBe(true)
      log.push(`${at()} armed: ${joinOnMuted() ? 'join on muted' : 'already reopened'}`)
      if (current === mutedId) {
        await b.clock.fastForward(2_600)
        log.push(`${at()} jumped`)
      }
    }
    await expect.poll(() => b.evaluate((id) => !!(window as unknown as Probe).__presence?.others.includes(id), id), {intervals: [50], timeout: 8_000}).toBe(true)
    log.push(`${at()} B sees A`)
  } finally {
    console.log(`[probe ${SHAPE}]\n` + log.join('\n'))
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})
