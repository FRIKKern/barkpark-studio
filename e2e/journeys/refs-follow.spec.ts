import {expect, test} from '../rig/test'
import {installProbes, networkBudget, recordFeel, sharedLocalToken} from '../rig/feel'
import {target, closeAndSettle, reveal} from '../rig/targets'
import {referenceHold} from '../rig/reference'

// J23, the crown reference journey's live half (J08 and J22: refs.spec; split for CI's
// shards, task-c1df532bed870536): edit the referenced doc in its pane; parents follow,
// live, here and in a second browser. Budgets apply to ours.
test.beforeEach(async ({context}, info) => {
  await Promise.all([target(info).prepare(context), installProbes(context)])
})
test.afterEach(async ({page}) => closeAndSettle(page))

test('J23: edit the referenced doc in its pane; parents follow here and in a 2nd browser', async ({browser}, info) => {
  const t = target(info)
  const recording = !!process.env.RECORDING_RUN_ID
  const options = recording ? {recordVideo: {dir: info.outputPath('videos'), size: {width: 1440, height: 900}}, viewport: {width: 1440, height: 900}} : {}
  const [ctxA, ctxB] = await Promise.all([browser.newContext(options), browser.newContext(options)])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto('/structure/post;post-08;author-grace,type=author,parentRefPath=author'), b.goto(t.docPath('post', 'post-08'))])
    await Promise.all([t.settle(a), t.settle(b)])
    await expect(t.field(a, 'name')).toHaveValue('Grace Hopper')
    const bRef = t.refLink(t.pane(b, 2), 'author')
    await expect(bRef).toContainText('Grace Hopper')
    await Promise.all([referenceHold(a, t.field(a, 'name'), 'Grace Hopper'), referenceHold(b, bRef)])
    // B is typing in its own title, caret mid-word: a remote change must not move it (F6).
    await t.field(b, 'title').click()
    await t.field(b, 'title').evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4))

    await t.field(a, 'name').click()
    await a.keyboard.press('End')
    const seen = bRef.evaluate(async (el) => {
      while (!el.textContent?.includes('Grace Hopper X')) await new Promise(requestAnimationFrame)
      return performance.timeOrigin + performance.now()
    })
    const sent = Date.now()
    await a.keyboard.type(' X')
    await expect(t.refLink(t.pane(a, 2), 'author')).toContainText('Grace Hopper X')
    const ms = (await seen) - sent
    recordFeel('F4', ms)

    const focus = await b.evaluate(() => ({id: document.activeElement?.id, caret: (document.activeElement as HTMLInputElement)?.selectionStart}))
    expect(focus, 'F6: focus and caret stay put in B').toEqual({id: 'title', caret: 4})
    // QUALITY F4 is p95 < 300 ms. Writes are coalesced to one per 750 ms while the
    // shared token's write budget is 60/min (task-2c31de0cf6597d32), so the last
    // keystroke of a burst can wait one gap. Back to 300 when that lands.
    // Local, one token for studio and rig: no budget (sharedLocalToken).
    if (t.name === 'studio' && !sharedLocalToken()) expect(ms, 'F4 edit seen in 2nd browser').toBeLessThan(networkBudget(1000))
    console.log(`[J23 ${t.name}] A's edit seen in B after ${Math.round(ms)} ms`)
    await Promise.all([referenceHold(a, t.field(a, 'name'), 'Grace Hopper X'), referenceHold(b, bRef)])
    // The list's author subtitle must remain live after B closes its post pane;
    // subscribing to post mutations alone leaves an already-loaded author stale.
    // Ours: the write lands after the list rendered on the server but before its
    // stream opens (held), and still reaches it (task-e888fb12ca6ff84c).
    let release = () => {}
    if (t.name === 'studio') {
      const held = new Promise<void>((r) => (release = r))
      await b.route('**/api/stream?**', async (route) => (await held, route.continue())) // the tab's one stream (lib/stream.ts)
    }
    await b.goto(t.listPath('post'))
    const row = await reveal(t.listItem(b, 'post-08'))
    await expect(row).toContainText('Grace Hopper X')
    // A's edit has forked a draft; Sanity's direct helper names versions explicitly.
    await t.patch(t.name === 'sanity' ? 'drafts.author-grace' : 'author-grace', {name: 'Grace Hopper live'}, 'author')
    release()
    await expect(row).toContainText('Grace Hopper live')
    await referenceHold(b, row)
  } finally {
    try {
      await t.restore('author-grace', {name: 'Grace Hopper'}, 'author')
    } finally {
      await Promise.all([ctxA.close(), ctxB.close()])
      if (recording) {
        for (const [name, page] of [['editor', a], ['observer', b]] as const) {
          await info.attach(`J23-${name}`, {path: await page.video()!.path(), contentType: 'video/webm'})
        }
      }
    }
  }
})
