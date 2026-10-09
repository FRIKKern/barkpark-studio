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
    await Promise.all([a.goto(t.docPath('post', 'post-03')), b.goto(t.docPath('post', 'post-03'))])
    await Promise.all([t.settle(a), t.settle(b)])
    const others = b.getByRole('button', {name: "Who's online"}).locator('.count')
    await expect(others).toHaveText('1', {timeout: 10_000})
    const closed = Date.now()
    await a.close({runBeforeUnload: true})
    await expect(others).toHaveCount(0, {timeout: 10_000})
    const ms = Date.now() - closed
    info.annotations.push({type: 'closed tab gone after (ms)', description: String(ms)})
    console.log(`[J07 leave] A gone from B's room after ${ms} ms`)
    expect(ms, 'gone within 2 s').toBeLessThan(2000)
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})
