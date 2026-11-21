import {expect, test} from '../rig/test'
import {target} from '../rig/targets'

// J07 (task-936472b77285df5b): a closed tab leaves the room at once. Two browsers on
// post-03; B's room has A; A's tab closes (its pagehide calls Barkpark's leave through
// /api/presence); A is gone from B's room within 2 s, not when A's
// stream's next keepalive fails. (The avatar on the document follows A's focus, cleared
// sooner; the room is what lingered.) Ours only: Sanity's presence is its own.
test('J07: a closed tab is gone from the other browser within 2 s', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Barkpark's presence room")
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    // A by its own session, not by a head count: other pages may come and go meanwhile.
    type Probe = {__presence?: {self: string | null; others: string[]}}
    await Promise.all([a.goto(t.docPath('post', 'post-03')), b.goto(t.docPath('post', 'post-03'))])
    await Promise.all([t.settle(a), t.settle(b)])
    await a.waitForFunction(() => !!(window as unknown as Probe).__presence?.self)
    const id = await a.evaluate(() => (window as unknown as Probe).__presence!.self!)
    const seesA = () => b.evaluate((id) => !!(window as unknown as Probe).__presence?.others.includes(id), id)
    await expect.poll(seesA, {intervals: [50], timeout: 10_000}).toBe(true)
    const closed = Date.now()
    await a.close({runBeforeUnload: true})
    await expect.poll(seesA, {timeout: 10_000, intervals: [25]}).toBe(false)
    const ms = Date.now() - closed
    info.annotations.push({type: 'closed tab gone after (ms)', description: String(ms)})
    console.log(`[J07 leave] A gone from B's room after ${ms} ms`)
    expect(ms, 'gone within 2 s').toBeLessThan(2000)
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})

// A dropped network that sends no reset (a Wi-Fi switch, a sleep): the tab's presence
// stream stays open and hears nothing, so the room froze as it was (task-d9d63c42491b2637).
// Now a stream quiet past Barkpark's pings is reopened: B, muted, still sees A arrive.
test('J07: a presence stream gone quiet without closing is reopened, and a newcomer shows', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Barkpark's presence room")
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    type Probe = {__presence?: {self: string | null; others: string[]}; __mutePresence?: (ms: number) => void}
    await b.goto(t.docPath('post', 'post-03'))
    await t.settle(b)
    await b.waitForFunction(() => !!(window as unknown as Probe).__presence?.self)
    await b.evaluate(() => (window as unknown as Probe).__mutePresence!(1500))
    await a.goto(t.docPath('post', 'post-03'))
    await t.settle(a)
    await a.waitForFunction(() => !!(window as unknown as Probe).__presence?.self)
    const id = await a.evaluate(() => (window as unknown as Probe).__presence!.self!)
    await expect.poll(() => b.evaluate((id) => !!(window as unknown as Probe).__presence?.others.includes(id), id), {intervals: [50], timeout: 8_000}).toBe(true)
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})

// Who's online (J07): picking someone opens their document at the field they are in, as
// Sanity's presence menu does (it opened the document at its top).
test('@local J07: who\'s online opens the other editor\'s document at their field', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Barkpark's presence room")
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto(t.listPath('post')), b.goto(t.docPath('post', 'post-03'))])
    await Promise.all([t.settle(a), t.settle(b)])
    await t.field(b, 'excerpt').click()
    // B's field reaches A's room on B's next presence beat (the room carries no probe for it).
    await a.waitForTimeout(1500)
    await a.getByRole('button', {name: 'Global presence'}).click()
    await a.getByRole('menuitem').filter({hasText: 'Fixture post 03'}).first().click()
    await expect(a).toHaveURL(/post-03,path=excerpt/)
    await expect(t.field(a, 'excerpt')).toBeFocused()
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})

// Above/below hints (J07) for someone in the body: their path is a block's
// (`body[_key=="…"]`), which the hint found no place for, so none showed.
test('@local J07: someone typing in the body far below shows as a hint', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Barkpark's presence room")
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto(t.docPath('post', 'post-03')), b.goto(t.docPath('post', 'post-03'))])
    await Promise.all([t.settle(a), t.settle(b)])
    await b.getByRole('tab', {name: 'All fields'}).click()
    await b.locator('.body-canvas').first().click()
    await expect(a.locator('.presence-hint.below')).toBeVisible({timeout: 10_000})
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})

// J07 at many viewers, as Sanity's: one avatar and one row per person (a person's tabs
// are one), past the limit a counter of the rest (a bare number) before the last few,
// and a positive dot on the navbar's button. The room is answered here: six people,
// one of them in two tabs, one in no document.
test('@local J07: many viewers: one per person, the counter, the menu', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "Barkpark's presence room")
  const P = (sessionId: string, name: string, documentId: string | null, field: string | null) => ({sessionId, name, color: '#556bfc', documentId, field, client: 'studio'})
  const room = [P('s1', 'Ada Lovelace', 'post-05', 'title'), P('s2', 'Ada Lovelace', 'post-05', 'excerpt'), P('s3', 'Grace Hopper', 'post-05', 'title'), P('s4', 'Alan Turing', 'post-05', 'title'), P('s5', 'Barbara Liskov', 'post-05', 'title'), P('s6', 'Edsger Dijkstra', 'post-05', 'title'), P('s7', 'Linus Torvalds', null, null)]
  await t.prepare(context)
  // The tab's one stream (/api/stream) carries the room; focus moves and leaves answer 204.
  await context.route('**/api/stream**', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({status: 200, headers: {'content-type': 'text/event-stream'}, body: `retry: 600000\n\nevent: stream\ndata: {"id":"fake"}\n\nevent: session\ndata: {"sessionId":"me"}\n\nevent: presence\ndata: ${JSON.stringify({presences: room})}\n\n`})
      : r.fulfill({status: 204, body: ''}),
  )
  await context.route('**/api/presence**', (r) => r.fulfill({status: 204, body: ''}))
  await page.goto(t.listPath('post'))
  await t.settle(page)
  // The list row: 5 people, at most 2: a counter of 4, then the last one; its hover says how many.
  const row = page.locator('a[href$=";post-05"]').first().locator('[data-testid="presence"]')
  await expect(row).toHaveAttribute('title', '5 people are editing this document right now')
  await expect(row.locator('.p-avatar')).toHaveText(['4', 'ED'])
  // The navbar: a dot, not a count; a row per person, the one in no document disabled.
  const who = page.getByRole('button', {name: 'Global presence'})
  await expect(who.locator('.who-dot')).toBeVisible()
  await who.click()
  await expect(page.locator('.who-menu .who-name')).toHaveText(['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Barbara Liskov', 'Edsger Dijkstra', 'Linus Torvalds'])
  await expect(page.locator('.who-menu [role=menuitem]').last()).toBeDisabled()
  await page.keyboard.press('Escape')
  // A field: 5 people, at most 3: a counter of 3, then the last two.
  await page.goto(t.docPath('post', 'post-05'))
  await t.settle(page)
  await expect(page.locator('.field').filter({has: page.locator('[id="title"]')}).locator('[data-testid="presence"] .p-avatar').first()).toHaveText('3')
})
