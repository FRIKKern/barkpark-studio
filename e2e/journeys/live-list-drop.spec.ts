import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// Split from live-list.spec for CI's shards (task-c1df532bed870536).

// The race of live-list.spec's reorder made certain (task-8cc2a447b03bf599, CI run
// 38704390838): B's page draws A's words late, and B drops its reorder in that gap. B's drop
// was made from the list it showed, but went out against the newer version it held, and
// undid A's words.
test('live: a reorder dropped before the typing is drawn keeps the typed words', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: a lever on our own page')
  const id = `post-list-${Date.now().toString(36)}`
  // The probe is made while the browsers get ready.
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext(), t.draftOnly(id, 'post', {title: 'List probe', slug: {_type: 'slug', current: id}, highlights: ['one', 'two', 'three']})])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    // Both browsers load at once (two contexts, nothing shared).
    await Promise.all(
      [a, b].map(async (p) => {
        await p.goto(t.docPath('post', id))
        await signInIfAsked(p)
        await t.settle(p)
        await p.getByRole('tab', {name: 'Meta'}).click()
      }),
    )
    const item = (p: typeof a, n: number) => p.locator(`[id="highlights[${n}]"]`)
    await expect(item(b, 1)).toHaveValue('two')
    await b.evaluate(() => (((window as {__liveFrames?: string[]}).__liveFrames = []), (window as {__holdRenders?: (on: boolean) => void}).__holdRenders?.(true)))
    await item(a, 1).click()
    await a.keyboard.press('End')
    await a.keyboard.insertText('-by-A')
    // A's words are saved and in B's cache, not drawn (an unrelated redraw, e.g. A's presence, may draw them: then the drop is plain).
    await expect.poll(() => b.evaluate(() => (window as {__liveFrames?: string[]}).__liveFrames?.length ?? 0), {intervals: [50]}).toBeGreaterThan(0)
    await b.getByRole('button', {name: 'Move item 1'}).focus()
    await b.keyboard.press('Space')
    await b.keyboard.press('ArrowDown')
    await b.keyboard.press('Space')
    await b.evaluate(() => (window as {__holdRenders?: (on: boolean) => void}).__holdRenders?.(false))
    for (const p of [a, b]) {
      await expect(item(p, 0)).toHaveValue('two-by-A', {timeout: 10_000})
      await expect(item(p, 1)).toHaveValue('one')
      await expect(item(p, 2)).toHaveValue('three')
    }
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
    await t.deleteDoc(id, 'post')
  }
})
