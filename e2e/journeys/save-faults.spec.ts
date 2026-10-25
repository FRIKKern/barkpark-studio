import {expect, test} from '../rig/test'
import {bpMutate, signInIfAsked, target, bpRemove, closeAndSettle} from '../rig/targets'

// Save fault sweep (task-2f360f9920e578b1): a write whose answer is lost on a live connection
// (a reset mid-request; the server's e2e lever) says "Not saved — retrying", not "Offline", and
// what was typed is stored once it goes again. A scratch post, deleted after.
test('a save whose answer is lost says retrying, not offline, and lands once', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the lever is our server')
  const id = `post-reset-${Date.now().toString(36)}`
  await bpMutate([{createOrReplace: {_id: id, _type: 'post', title: 'Reset'}}])
  const fault = (kind: string, more: Record<string, unknown> = {}) => page.request.post('/api/e2e-listen', {data: {action: 'write-fault', id, kind, ...more}})
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await fault('reset', {count: 1})
    await t.field(page, 'title').fill('Reset typed')
    const status = page.locator('.doc-footer [role=status]').first()
    await expect(status).toHaveText(/Not saved — retrying/)
    await expect(status).not.toHaveText(/Offline/)
    await expect.poll(() => t.docValue(id, 'title'), {timeout: 6_000}).toBe('Reset typed')
  } finally {
    await fault('none').catch(() => {})
    await closeAndSettle(page)
    await bpRemove(id, 'post')
  }
})


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
    await page.waitForTimeout(2200) // it retried every 2 s before
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

// The whole sweep, longer (@local): 500s for 15 s, saves hanging 10 s, a storm of twenty 412s,
// three lost answers, one 413, and 500s with a reload in the middle. Typing goes on through
// each; after each recovery the title is exactly what was typed (no key lost or doubled).
test('@local five save faults and a reload mid-fault: every key stored exactly once', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the lever is our server')
  test.setTimeout(240_000)
  const id = `post-faults-${Date.now().toString(36)}`
  await bpMutate([{createOrReplace: {_id: id, _type: 'post', title: 'F'}}])
  const fault = (kind: string, more: Record<string, unknown> = {}) => page.request.post('/api/e2e-listen', {data: {action: 'write-fault', id, kind, ...more}})
  let expected = 'F'
  const title = () => t.field(page, 'title')
  const type = async (w: string) => {
    await expect(title()).toBeEditable()
    await title().click()
    await page.keyboard.press('ControlOrMeta+ArrowRight')
    await page.keyboard.type(w, {delay: 20})
    expected += w
  }
  const exact = (timeout = 20_000) => expect.poll(() => t.docValue(id, 'title'), {timeout}).toBe(expected)
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await fault('500', {ms: 15_000})
    for (const w of [' a1', ' a2']) (await type(w), await page.waitForTimeout(3000))
    await expect(page.locator('.doc-footer [role=status]').first()).toHaveText(/Not saved — retrying/)
    await exact()
    await fault('hang', {ms: 10_000})
    for (const w of [' b1', ' b2']) (await type(w), await page.waitForTimeout(2000))
    await fault('none')
    await exact()
    await fault('412', {count: 20})
    for (const w of [' c1', ' c2']) (await type(w), await page.waitForTimeout(2000))
    // Five quick rebases, then one try every 2 s: the rest of the twenty take about 30 s.
    await exact(40_000)
    await fault('reset', {count: 3})
    for (const w of [' d1', ' d2']) (await type(w), await page.waitForTimeout(2000))
    await exact()
    await fault('413', {count: 1})
    // One input: a key typed after the refusal is an edit, and an edit tries again by itself.
    await title().click()
    await page.keyboard.press('ControlOrMeta+ArrowRight')
    await page.keyboard.insertText(' e1')
    expected += ' e1'
    await page.locator('.doc-footer').getByRole('button', {name: 'Retry'}).click()
    await exact()
    await fault('500', {ms: 12_000})
    await type(' f1')
    await page.waitForTimeout(2000)
    page.once('dialog', (d) => void d.accept())
    await page.reload()
    await t.settle(page)
    await exact()
    await expect(title()).toHaveValue(expected)
  } finally {
    await fault('none').catch(() => {})
    await closeAndSettle(page)
    await bpRemove(id, 'post')
  }
})
