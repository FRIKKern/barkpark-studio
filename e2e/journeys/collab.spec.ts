import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// Collaboration hour (D11 widen): two editors type in the same body paragraph at once.
// The canvas has no live co-editing in one block yet, so the later writer's batch must
// never land silently over the first one's words: either both survive, or the later
// writer gets the conflict card (D20) and the document's footer says "Not saved".
const ID = 'post-26'
test.afterEach(async ({}, info) => target(info).resetDoc(ID, 'post'))

test('@local D11: two editors in one paragraph — nothing is lost silently', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the canvas host')
  const open = async () => {
    const ctx = await browser.newContext()
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
  await a.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await b.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
  await a.keyboard.type(' AAA')
  await b.keyboard.type('BBB ')
  await a.waitForTimeout(3000)
  const server = JSON.stringify(await t.docValue(ID, 'body'))
  const card = async (p: Page) => (await p.locator('.pd-conflict').count()) > 0
  const bothKept = server.includes('AAA') && server.includes('BBB')
  const asked = (await card(a)) || (await card(b))
  expect(bothKept || asked, `server ${server.slice(0, 200)}`).toBe(true)
  if (asked) {
    const loser = (await card(b)) ? b : a
    await expect(loser.locator('.doc-footer')).toContainText('Not saved')
    await loser.getByRole('button', {name: 'Re-apply my edit on top'}).click()
    await expect.poll(async () => JSON.stringify(await t.docValue(ID, 'body')), {timeout: 15_000}).toContain(loser === b ? 'BBB' : 'AAA')
  }
})
