import {expect, test, type Page} from '@playwright/test'
import {target} from '../rig/targets'

// A Barkpark deploy (blue/green) while editors work: main went red at 9398ab6 when Caddy
// flipped at 02:07:04 UTC 2026-10-10 and the old instance stopped under two runs.
// - J19: a search read met the stop (a reset): "Could not fetch search results".
// - D11: the presence stream stayed on the old instance, deaf: no remote caret.
// Levers: POST /api/e2e-listen (the studio server runs with STUDIO_E2E_HOOKS=1).
const lever = (page: Page, action: 'deaf' | 'flip' | 'read-blip', ms?: number) =>
  page.request.post('/api/e2e-listen', {data: {action, ms}}).then((r) => expect(r.ok(), `lever ${action}`).toBe(true))

test('a read that meets a deploy is asked again: search still answers', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'our server')
  await t.prepare(page.context())
  await page.goto('/structure')
  await t.settle(page)
  await page.keyboard.press('ControlOrMeta+k')
  await lever(page, 'read-blip', 400)
  await page.keyboard.type('Fixture post 0')
  await expect(page.getByRole('option').first()).toContainText('Fixture post', {timeout: 10_000})
  await expect(page.getByRole('alert').filter({hasText: 'Could not fetch search results'})).toHaveCount(0)
})

test('@local a deploy leaves the presence stream deaf; a new instance re-opens it and the caret shows', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'our presence proxy')
  test.setTimeout(60_000)
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto(t.docPath('paper', 'paper-01')), b.goto(t.docPath('paper', 'paper-01'))])
    await Promise.all([t.settle(a), t.settle(b)])
    const paraA = a.locator('bp-paper-canvas .ProseMirror p').first()
    await expect(paraA).toBeVisible({timeout: 20_000})
    await expect(b.locator('bp-paper-canvas .ProseMirror p').first()).toBeVisible({timeout: 20_000})
    await lever(a, 'deaf')
    await paraA.click()
    const caret = b.locator('bp-paper-canvas .bp-remote-caret')
    await b.waitForTimeout(2000)
    expect(await caret.count(), 'deaf: no caret').toBe(0)
    await lever(a, 'flip')
    await expect(caret).toHaveCount(1, {timeout: 12_000})
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})
