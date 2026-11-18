import {expect, test} from '../rig/test'
import {bpMutate, signInIfAsked, target, bpRemove, closeAndSettle} from '../rig/targets'

// Save fault sweep (task-2f360f9920e578b1), split from save-faults.spec for CI's shards
// (task-c1df532bed870536). A scratch post, deleted after.

// A save refused as too large (413) stops: it says why, keeps the text, sends nothing more on
// its own, and goes again on Retry (it retried every 2 s, saying only "retrying").
test('a save refused as too large says why, stops, and goes again on Retry', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the lever is our server')
  const id = `post-413-${Date.now().toString(36)}`
  await bpMutate([{createOrReplace: {_id: id, _type: 'post', title: 'Big'}}])
  const fault = (kind: string, more: Record<string, unknown> = {}) => page.request.post('/api/e2e-listen', {data: {action: 'write-fault', id, kind, ...more}})
  try {
    await t.prepare(page.context())
    // The page's clock, run on by the test past the 2 s it retried after instead of waited out;
    // otherwise it keeps real time.
    await page.clock.install()
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await fault('413', {count: 1})
    let sent = 0
    page.on('request', (r) => r.method() === 'POST' && r.url().includes('_serverFn') && (r.postData() ?? '').includes(id) && sent++)
    await t.field(page, 'title').fill('Big typed')
    const footer = page.locator('.doc-footer')
    await expect(footer).toContainText('This document is too large to save. Remove some content.')
    const tries = sent
    // It retried every 2 s before (lib/edits.ts): the page's clock run past that, then 200 ms for
    // a send it started to leave.
    await page.clock.runFor(2200)
    await page.waitForTimeout(200)
    expect(sent, 'nothing more sent on its own').toBe(tries)
    await expect(t.field(page, 'title')).toHaveValue('Big typed')
    await footer.getByRole('button', {name: 'Retry'}).click()
    await expect.poll(() => t.docValue(id, 'title'), {timeout: 5_000}).toBe('Big typed')
  } finally {
    await fault('none').catch(() => {})
    await closeAndSettle(page)
    await bpRemove(id, 'post')
  }
})
