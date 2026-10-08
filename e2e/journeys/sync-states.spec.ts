import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J20 evidence, both studios, on post-17's excerpt: 10 s offline while typing, then
// back; and (ours) a write that hangs. What the footer says at each step goes to the
// annotations; the server copy must hold every keystroke after (F8: nothing lost).
// Sanity's footer says "Saving..." throughout; ours names the state: offline (not
// saving, edits kept), recovering, stalled. Stills + clips in e2e/evidence/.
const ID = 'post-17'
const EXCERPT = 'Short excerpt for post 17.'
const shot = (name: string, step: string) => `evidence/J20-${name}-${step}.png`
test.use({video: 'on'})
test.setTimeout(120_000)

test.afterEach(async ({context}, info) => {
  await context.setOffline(false)
  await target(info).restore(ID, {excerpt: EXCERPT})
})

const footer = (page: Page) => page.locator('[data-testid="pane-footer"], .doc-footer').first()

test('@evidence J20: offline while typing, back online, a stalled write — nothing lost', async ({page, context}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => info.annotations.push({type: what, description: JSON.stringify(v)})
  await t.prepare(context)
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await t.field(page, 'excerpt').click()
  await page.keyboard.press('End')

  // 10 s offline, typing all the while.
  await context.setOffline(true)
  const offlineSaid = new Set<string>()
  for (let i = 0; i < 10; i++) {
    await page.keyboard.type(` o${i}`)
    await page.waitForTimeout(1000)
    offlineSaid.add((await footer(page).innerText()).split('\n')[0]!.trim())
  }
  note('footer while offline', [...offlineSaid])
  await page.screenshot({path: shot(t.name, '1-offline')})
  if (t.name === 'studio') {
    await expect(footer(page)).toContainText('Offline — not saving. Your edits are kept here.')
    await expect(page.getByRole('button', {name: /^Publish$/}).last()).toBeDisabled()
  }

  // Back online: recovering, then saved — with every keystroke.
  await context.setOffline(false)
  const after = new Set<string>()
  for (let i = 0; i < 6; i++) {
    after.add((await footer(page).innerText()).split('\n')[0]!.trim())
    await page.waitForTimeout(500)
  }
  note('footer after reconnect', [...after])
  const typed = `${EXCERPT}${Array.from({length: 10}, (_, i) => ` o${i}`).join('')}`
  const kept = await expect.poll(() => t.docValue(ID, 'excerpt'), {timeout: 20_000}).toBe(typed).then(() => true, () => false)
  note('server holds every keystroke', kept ? true : await t.docValue(ID, 'excerpt'))
  await page.screenshot({path: shot(t.name, '2-recovered')})
  if (t.name === 'studio') expect(kept, 'nothing lost').toBe(true)
  if (t.name === 'studio') await expect(footer(page)).toContainText(/Saved|Edited/)

  // Ours: a write that hangs for 6 s says so, then lands.
  if (t.name === 'studio') {
    await page.route('**/_serverFn/**', async (route) => {
      if (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations')) await new Promise((r) => setTimeout(r, 6000))
      await route.continue()
    })
    await page.keyboard.type(' slow')
    await expect(footer(page)).toContainText('Saving is taking longer than usual…', {timeout: 8_000})
    await page.screenshot({path: shot(t.name, '3-stalled')})
    await expect.poll(() => t.docValue(ID, 'excerpt'), {timeout: 20_000}).toBe(`${typed} slow`)
    await expect(footer(page)).toContainText(/Saved|Edited/)
    await page.unroute('**/_serverFn/**')
  }
})
