import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// J07 (task-936472b77285df5b): a closed tab leaves the room at once. Two browsers on
// post-03; B's room has A; A's tab closes (its pagehide calls Barkpark's leave through
// /api/presence); A is gone from B's room within 2 s, not when A's
// stream's next keepalive fails. (The avatar on the document follows A's focus, cleared
// sooner; the room is what lingered.) Ours only: Sanity's presence is its own.
test('J07: a closed tab is gone from the other browser within 2 s', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Barkpark's presence room")
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    // A by its own session, not by a head count: other pages may come and go meanwhile.
    type Probe = {__presence?: {self: string | null; others: string[]}}
    await Promise.all([a.goto(t.docPath('post', 'post-03')), b.goto(t.docPath('post', 'post-03'))])
    await Promise.all([t.settle(a), t.settle(b)])
    await a.waitForFunction(() => !!(window as unknown as Probe).__presence?.self)
    const id = await a.evaluate(() => (window as unknown as Probe).__presence!.self!)
    const seesA = () => b.evaluate((id) => !!(window as unknown as Probe).__presence?.others.includes(id), id)
    await expect.poll(seesA, {timeout: 10_000}).toBe(true)
    const closed = Date.now()
    await a.close({runBeforeUnload: true})
    await expect.poll(seesA, {timeout: 10_000, intervals: [25]}).toBe(false)
    const ms = Date.now() - closed
    info.annotations.push({type: 'closed tab gone after (ms)', description: String(ms)})
    console.log(`[J07 leave] A gone from B's room after ${ms} ms`)
    expect(ms, 'gone within 2 s').toBeLessThan(2000)
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})
