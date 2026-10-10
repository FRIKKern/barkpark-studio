import {expect, test, type BrowserContext, type Page} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// Collaboration hour (D11 widen): two editors type in the same body paragraph at once.
// The canvas has no live co-editing in one block yet, so the later writer's batch must
// never land silently over the first one's words: either both survive, or the later
// writer gets the conflict card (D20) and the document's footer says "Not saved".
const ID = 'post-26'
test.setTimeout(60_000) // two browsers and two canvases to open; a cold first run is slow
// Contexts made from `browser` are not closed with the test: closed here, or their pages
// stay open (and in the presence room, and on post-26) for the rest of the run.
const contexts: BrowserContext[] = []
test.afterEach(async ({}, info) => {
  await Promise.all(contexts.splice(0).map((c) => c.close()))
  await target(info).resetDoc(ID, 'post')
})

test('@local D11: two editors in one paragraph — nothing is lost silently', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the canvas host')
  const open = async () => {
    const ctx = await browser.newContext()
    contexts.push(ctx)
    await t.prepare(ctx)
    const page = await ctx.newPage()
    await page.goto(t.docPath('post', ID))
    await signInIfAsked(page)
    await t.settle(page)
    const body = page.locator('[id="body"]')
    await body.scrollIntoViewIfNeeded()
    await body.getByText('Body paragraph for post 26.').click()
    await expect(body.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
    // COLLAB_SLOW_MS: each request that much slower (a slow network, or a busy Barkpark).
    if (process.env.COLLAB_SLOW_MS) await page.route('**/_serverFn/**', async (r) => (await new Promise((s) => setTimeout(s, Number(process.env.COLLAB_SLOW_MS))), r.continue()))
    return page
  }
  const [a, b] = [await open(), await open()]
  await a.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await b.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
  await a.keyboard.type(' AAA')
  await b.keyboard.type('BBB ')
  // Wait on the real signal, not a fixed time (a save can take seconds when Barkpark is
  // busy): both words on the server, or a card on a page. Then, after a moment for any
  // late write, it must still hold: a card on screen, or both words kept.
  const p26 = async () => ((await t.docValue(ID, 'body')) as {blocks: {id: string; content?: {value?: string}[]}[]}).blocks.find((x) => x.id === 'p26')?.content?.map((c) => c.value).join('') ?? ''
  const card = async (p: Page) => (await p.locator('.pd-conflict').count()) > 0
  const state = async () => {
    const text = await p26()
    if (text.includes('AAA') && text.includes('BBB')) return 'both kept'
    return (await card(a)) || (await card(b)) ? 'asked' : `server "${text}"`
  }
  await expect.poll(state, {timeout: 15_000}).not.toMatch(/^server/)
  await a.waitForTimeout(1500)
  const settled = await state()
  expect(settled, 'nothing lost silently').not.toMatch(/^server/)
  if (settled === 'asked') {
    // The later writer was asked: a clash ("Re-apply my edit on top"), or a batch Barkpark
    // refused (Retry, which then meets the clash). Re-applying puts their words back.
    const loser = (await card(b)) ? b : a
    const mine = loser === b ? 'BBB' : 'AAA'
    await expect(loser.locator('.doc-footer')).toContainText('Not saved')
    const reapply = loser.getByRole('button', {name: 'Re-apply my edit on top'})
    const retry = loser.getByRole('button', {name: 'Retry', exact: true})
    await expect(reapply.or(retry)).toBeVisible()
    if (await retry.isVisible()) {
      await retry.click()
      await expect.poll(async () => (await reapply.isVisible()) || (await p26()).includes(mine), {timeout: 15_000}).toBe(true)
    }
    if (await reapply.isVisible()) await reapply.click()
    await expect.poll(p26, {timeout: 15_000}).toContain(mine)
  }
})

test('@local D11: an edit that already holds the other writer\'s words is not called a conflict', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the canvas host')
  const open = async () => {
    const ctx = await browser.newContext()
    contexts.push(ctx)
    await t.prepare(ctx)
    const page = await ctx.newPage()
    await page.goto(t.docPath('post', ID))
    await signInIfAsked(page)
    await t.settle(page)
    const body = page.locator('[id="body"]')
    await body.scrollIntoViewIfNeeded()
    await body.getByText('Body paragraph for post 26.').click()
    await expect(body.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
    return page
  }
  const [a, b] = [await open(), await open()]
  // A writes in the paragraph B is sitting in (B idle: the canvas defers A's block).
  await a.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await a.keyboard.type(' AAA')
  await expect.poll(async () => JSON.stringify(await t.docValue(ID, 'body')), {timeout: 15_000}).toContain('AAA')
  await b.waitForTimeout(1000)
  // B leaves the paragraph (the canvas takes A's words), comes back, types.
  await t.field(b, 'title').click()
  await expect(b.locator('[id="body"]')).toContainText('AAA', {timeout: 15_000})
  await b.locator('[id="body"]').getByText(/AAA/).click()
  await b.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await b.keyboard.type(' BBB')
  await b.waitForTimeout(3000)
  expect(await b.locator('.pd-conflict').count(), 'no conflict card').toBe(0)
  const server = JSON.stringify(await t.docValue(ID, 'body'))
  expect(server).toContain('AAA')
  expect(server).toContain('BBB')
})
