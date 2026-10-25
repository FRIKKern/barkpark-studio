import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// Two browsers on one list: A types in an item while B moves another item past it. Both
// stay: B's order, and A's words in the item A is typing in, which moves with A's caret
// (Sanity keeps the order but puts the rest of A's typing into whatever item lands there).
test('live: a reorder by one editor survives the other typing in an item', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's result is the scout's (it splits the typing)")
  const id = `post-list-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'List probe', slug: {_type: 'slug', current: id}, highlights: ['one', 'two', 'three']})
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  // Flight recorder (task-03691f23ebb60c5c: CI once lost a typed "-", "two-byA", and the run
  // left nothing to tell which write carried it): both pages' saves of the list, their answers,
  // and the doc's frames on A, printed only when the test fails.
  const t0 = Date.now()
  const log: string[] = []
  const note = (s: string) => log.push(`${String(Date.now() - t0).padStart(6)} ${s}`)
  const list = (body: string) => body.match(/highlights"\],"v":\[\{"t":9,"i":\d+,"a":(\[[^\]]*\])/)?.[1]?.replace(/\{"t":1,"s":("[^"]*")\}/g, '$1') ?? ''
  for (const [n, p] of [['A', a], ['B', b]] as const)
    p.on('requestfinished', async (r) => {
      const body = r.postData() ?? ''
      if (r.method() !== 'POST' || !body.includes('mutations') || !body.includes('highlights')) return
      const res = await r.response()
      note(`${n} save ${list(body)} -> ${(await res?.text().catch(() => ''))?.match(/mutate \d+/)?.[0] ?? res?.status()}`)
    })
  const cdp = await ctxA.newCDPSession(a)
  await cdp.send('Network.enable')
  cdp.on('Network.eventSourceMessageReceived', (e) => e.eventName === 'mutation' && e.data.includes(id) && note(`A frame ${e.data.match(/"highlights":(\[[^\]]*\])/)?.[1] ?? '(no list)'}`))
  try {
    for (const p of [a, b]) {
      await p.goto(t.docPath('post', id))
      await signInIfAsked(p)
      await t.settle(p)
      await p.getByRole('tab', {name: 'Meta'}).click()
    }
    const item = (p: typeof a, n: number) => p.locator(`[id="highlights[${n}]"]`)
    await expect(item(b, 1)).toHaveValue('two')
    await item(a, 1).click()
    await a.keyboard.press('End')
    note('A types, B moves "one" down')
    const typing = a.keyboard.type('-by-A', {delay: 90})
    // B picks up "one" by keyboard and drops it one lower, while A types.
    await b.getByRole('button', {name: 'Move item 1'}).focus()
    await b.keyboard.press('Space')
    await b.keyboard.press('ArrowDown')
    await b.keyboard.press('Space')
    await typing
    note('A done')
    for (const p of [a, b]) {
      await expect(item(p, 0)).toHaveValue('two-by-A', {timeout: 10_000})
      await expect(item(p, 1)).toHaveValue('one')
      await expect(item(p, 2)).toHaveValue('three')
    }
  } catch (err) {
    console.log(`live-list sequence (${id}):\n${log.join('\n')}`)
    throw err
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
    await t.deleteDoc(id, 'post')
  }
})

// The race above made certain (task-8cc2a447b03bf599, CI run 38704390838): B's page draws
// A's words late, and B drops its reorder in that gap. B's drop was made from the list it
// showed, but went out against the newer version it held, and undid A's words.
test('live: a reorder dropped before the typing is drawn keeps the typed words', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: a lever on our own page')
  const id = `post-list-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'List probe', slug: {_type: 'slug', current: id}, highlights: ['one', 'two', 'three']})
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    for (const p of [a, b]) {
      await p.goto(t.docPath('post', id))
      await signInIfAsked(p)
      await t.settle(p)
      await p.getByRole('tab', {name: 'Meta'}).click()
    }
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

// Keys typed faster than the list redraws all land: an item's input was put back to the list's
// last drawn value after every key (a controlled input), so the next key built on that and
// dropped the one before ("two-A-yz--23" for "two-by-A-x-y-z-1-2-3"; task-03691f23ebb60c5c).
test('a list item keeps every key typed fast', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: the item input')
  const id = `post-list-${Date.now().toString(36)}`
  // The probe is made while the browser gets ready (as refs.spec, #935).
  await Promise.all([t.draftOnly(id, 'post', {title: 'List probe', slug: {_type: 'slug', current: id}, highlights: ['one', 'two', 'three']}), t.prepare(page.context())])
  try {
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('tab', {name: 'Meta'}).click()
    const item = page.locator('[id="highlights[1]"]')
    await item.click()
    await page.keyboard.press('End')
    await page.keyboard.type('-by-A-x-y-z-1-2-3', {delay: 5})
    await expect(item).toHaveValue('two-by-A-x-y-z-1-2-3')
    await expect.poll(() => t.docValue(id, 'highlights'), {timeout: 10_000}).toEqual(['one', 'two-by-A-x-y-z-1-2-3', 'three'])
  } finally {
    await t.deleteDoc(id, 'post')
  }
})
