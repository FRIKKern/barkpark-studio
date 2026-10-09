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
