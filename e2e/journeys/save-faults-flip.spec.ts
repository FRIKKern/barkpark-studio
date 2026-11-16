import {expect, test} from '../rig/test'
import {bpMutate, signInIfAsked, target, bpRemove} from '../rig/targets'

// Save fault sweep (task-2f360f9920e578b1), split from save-faults.spec for CI's shards
// (task-c1df532bed870536).

// task-9f604a45835a45e3: with saves failing, each key flipped the footer Saving → "Not saved —
// retrying" and back (and Publish's disabled with it): about 5x the style work per key on a long
// doc. Now the state holds until a save lands. Every POST is cut and the close-tab beacon (which
// a route doesn't see) is stubbed out; a scratch post, deleted after.
test('saves failing: typing on leaves "Not saved — retrying" as it is, no flip per key', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our footer')
  const id = `post-flip-${Date.now().toString(36)}`
  await bpMutate([{createOrReplace: {_id: id, _type: 'post', title: 'Flip'}}])
  try {
    await t.prepare(page.context())
    await page.route('**/*', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()))
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    const status = page.locator('.doc-footer .save-state').first()
    await t.field(page, 'title').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' x')
    await expect(status).toHaveAttribute('data-state', 'error')
    await page.evaluate(() => {
      const seen = {n: 0}
      new MutationObserver((ms) => (seen.n += ms.length)).observe(document.querySelector('.doc-footer .save-state')!, {attributes: true, attributeFilter: ['data-state']})
      Object.assign(window, {__flips: seen})
    })
    for (const c of 'abcdefgh') (await page.keyboard.type(c), await page.waitForTimeout(80))
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => (window as unknown as {__flips: {n: number}}).__flips.n)).toBe(0)
    await expect(status).toHaveAttribute('data-state', 'error')
  } finally {
    await page.evaluate(() => Object.assign(navigator, {sendBeacon: () => true})).catch(() => {})
    await page.close()
    await bpRemove(id, 'post')
  }
})
