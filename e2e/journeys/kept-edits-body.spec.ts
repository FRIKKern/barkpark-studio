import {expect, test} from '../rig/test'
import {target, closeAndSettle, savesLanded} from '../rig/targets'

// Body words the Freeform canvas had not saved yet go again: after a long offline stretch
// (with a field typed meanwhile), and after a batch a publish race answered 404. The form's
// kept edits (B11) are kept-edits.spec; split from it for CI's shards (task-c1df532bed870536).
const ID = 'post-29'
const EXCERPT = 'Short excerpt for post 29.'
const TITLE = 'Fixture post 29'
test.setTimeout(90_000)

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio') await target(info).restore(ID, {excerpt: EXCERPT, title: TITLE})
})

// Long-offline run (task-02febe8790364a30): body words typed offline were refused ("Could
// not save: Failed to fetch") and never sent again; once resent, the field save forking the
// draft at the same moment made Barkpark refuse them (invalid_op), or its live frame typed
// over them. Now they wait for the network, then go, with the fields typed meanwhile.
test('body words typed offline are saved once back, with a field typed meanwhile', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the Freeform canvas body')
  // The body as it was, read while the page loads (a read: the page writes nothing yet).
  const [body] = await Promise.all([t.docValue(ID, 'body'), page.goto(t.docPath('post', ID))])
  try {
    await t.settle(page)
    await page.locator('.body-canvas').first().click()
    const para = page.locator('.body-canvas .ProseMirror p').first()
    await para.waitFor()
    await context.setOffline(true)
    await t.field(page, 'title').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' off')
    await para.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' kept words')
    await expect(page.locator('.pd-status')).toHaveText(/^Offline/)
    await t.field(page, 'title').click()
    await context.setOffline(false)
    await savesLanded(page)
    await expect.poll(async () => JSON.stringify(await t.docValue(ID, 'body')), {timeout: 15_000}).toContain(' kept words')
    await expect(para).toContainText(' kept words')
    await expect.poll(() => t.docValue(ID, 'title'), {timeout: 15_000}).toBe(`${TITLE} off`)
  } finally {
    await t.restore(ID, {body})
  }
})

// Five editors on one post (task-86f75846c256e3b4): a body batch aimed at a draft that a
// publish removed on its way answered 404, and the canvas said "Could not save: document
// not found" over words that had only to go again on the published row's rev.
test('a body batch answered 404 by a publish race goes again', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the Freeform canvas body')
  let raced = false
  await page.route('**/_serverFn/**', (route) => {
    if (raced || route.request().method() !== 'POST' || !(route.request().postData() ?? '').includes('ifRev')) return route.continue()
    raced = true
    const v = (s: string) => ({t: 1, s})
    const result = {t: 10, i: 1, p: {k: ['ok', 'status', 'code', 'message', 'rev', 'throttled'], v: [{t: 2, s: 3}, {t: 0, s: 404}, v('not_found'), v('document not found'), v('stale'), {t: 2, s: 3}]}, o: 0}
    return route.fulfill({status: 200, headers: {'content-type': 'application/json', 'x-tss-serialized': 'true'}, body: JSON.stringify({t: 10, i: 0, p: {k: ['result', 'error', 'context'], v: [result, {t: 2, s: 1}, {t: 11, i: 2, p: {k: [], v: []}, o: 0}]}, o: 0})})
  })
  // The body as it was, read while the page loads (a read: the page writes nothing yet).
  const [body] = await Promise.all([t.docValue(ID, 'body'), page.goto(t.docPath('post', ID))])
  try {
    await t.settle(page)
    await page.locator('.body-canvas').first().click()
    const para = page.locator('.body-canvas .ProseMirror p').first()
    await para.waitFor()
    await para.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' raced words')
    await savesLanded(page)
    await expect.poll(async () => JSON.stringify(await t.docValue(ID, 'body')), {timeout: 10_000}).toContain(' raced words')
    expect(raced, 'the first batch was answered 404').toBe(true)
    await expect(page.locator('.pd-conflict')).toHaveCount(0)
  } finally {
    await page.unrouteAll({behavior: 'ignoreErrors'})
    await t.restore(ID, {body})
  }
})
