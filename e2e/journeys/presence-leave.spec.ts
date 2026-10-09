import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// J07 (task-936472b77285df5b): a closed tab leaves the room at once. Two browsers on
// post-03; B's "Who's online" counts A; A's tab closes (its pagehide calls Barkpark's
// leave through /api/presence); A is gone from B's count within 2 s, not when A's
// stream's next keepalive fails. (The avatar on the document follows A's focus, cleared
// sooner; the room is what lingered.) Ours only: Sanity's presence is its own.
test('J07: a closed tab is gone from the other browser within 2 s', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Barkpark's presence room")
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    // B first: whoever else is in the room (a page an earlier spec still has open) is
    // counted before A comes, and A is judged as that count plus one, then back.
    await b.goto(t.docPath('post', 'post-03'))
    await t.settle(b)
    const badge = b.getByRole('button', {name: "Who's online"}).locator('.count')
    const others = async () => ((await badge.count()) ? Number(await badge.textContent()) : 0)
    // B's first room frame has come (before it, no badge reads as nobody).
    await b.waitForFunction(() => ((window as unknown as {__presenceFrames?: number}).__presenceFrames ?? 0) > 0)
    const before = await others()
    await a.goto(t.docPath('post', 'post-03'))
    await t.settle(a)
    await expect.poll(others, {timeout: 10_000}).toBe(before + 1)
    const closed = Date.now()
    await a.close({runBeforeUnload: true})
    await expect.poll(others, {timeout: 10_000, intervals: [25]}).toBe(before)
    const ms = Date.now() - closed
    info.annotations.push({type: 'closed tab gone after (ms)', description: String(ms)})
    console.log(`[J07 leave] A gone from B's room after ${ms} ms`)
    expect(ms, 'gone within 2 s').toBeLessThan(2000)
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})
