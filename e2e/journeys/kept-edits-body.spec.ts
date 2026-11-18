import {expect, test} from '../rig/test'
import {target, closeAndSettle, savesLanded} from '../rig/targets'

// Body words the Freeform canvas had not saved yet go again after a long offline stretch (with
// a field typed meanwhile); after a batch a publish race answered 404: kept-edits-body-race.spec.
// The form's kept edits (B11) are kept-edits.spec; split from it for CI's shards
// (task-c1df532bed870536).
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
