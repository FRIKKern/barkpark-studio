import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// D11 (Freeform side track, ours only): shared carets. Two browsers on paper-01; A puts
// its caret in a paragraph and B's canvas draws it (a bar with A's name, in A's presence
// color) without moving B's own caret; A selects a range and B shows it; A leaves the
// canvas and B's copy goes. Nothing is written.
test('D11: a caret in Freeform shows in a 2nd browser, with its range, and goes when it leaves', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto(t.docPath('paper', 'paper-01')), b.goto(t.docPath('paper', 'paper-01'))])
    await Promise.all([t.settle(a), t.settle(b)])
    const paraA = a.locator('bp-paper-canvas .ProseMirror p').first()
    await expect(paraA).toBeVisible({timeout: 20_000})
    await expect(b.locator('bp-paper-canvas .ProseMirror p').first()).toBeVisible({timeout: 20_000})
    await paraA.click()
    const caret = b.locator('bp-paper-canvas .bp-remote-caret')
    await expect(caret).toHaveCount(1, {timeout: 5_000})
    expect(await b.evaluate(() => !!document.activeElement?.closest('bp-paper-canvas')), "B's own focus stays out of the canvas").toBe(false)
    // A range, shown translucent on B: the first word, by a double-click at the line's
    // start. Not keys: a click in the box's middle can land past short text (Shift+End then
    // selects nothing), and Home/End don't move the caret on macOS.
    await paraA.dblclick({position: {x: 4, y: 8}})
    await expect(b.locator('bp-paper-canvas .bp-remote-selection').first()).toBeVisible({timeout: 5_000})
    // A leaves the canvas: B's copy goes.
    await a.getByRole('button', {name: 'Show document actions'}).focus()
    await expect(caret).toHaveCount(0, {timeout: 5_000})
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})

// A Barkpark deploy flips Caddy to a new instance; B's presence stream, opened before,
// stays on the old one while A's caret goes to the new one (9398ab6, 2026-10-10: this
// spec red at the 02:07:04 flip). The proxy re-opens it on the new boot (server/boot.ts).
test('@local D11: a deploy leaves the presence stream deaf; a new instance re-opens it and the caret comes', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our presence proxy')
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  const lever = (action: 'presence-deaf' | 'flip') => b.request.post('/api/e2e-listen', {data: {action}}).then((r) => expect(r.ok(), `lever ${action}`).toBe(true))
  try {
    await Promise.all([a.goto(t.docPath('paper', 'paper-01')), b.goto(t.docPath('paper', 'paper-01'))])
    await Promise.all([t.settle(a), t.settle(b)])
    const paraA = a.locator('bp-paper-canvas .ProseMirror p').first()
    await expect(paraA).toBeVisible({timeout: 20_000})
    await expect(b.locator('bp-paper-canvas .ProseMirror p').first()).toBeVisible({timeout: 20_000})
    await lever('presence-deaf')
    await paraA.click()
    const caret = b.locator('bp-paper-canvas .bp-remote-caret')
    await b.waitForTimeout(1500)
    await expect(caret, 'deaf: no caret arrives').toHaveCount(0)
    await lever('flip')
    await expect(caret).toHaveCount(1, {timeout: 8_000})
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})
