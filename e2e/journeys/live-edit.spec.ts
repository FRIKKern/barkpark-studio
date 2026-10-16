import {expect, test, type Page} from '@playwright/test'
import {networkBudget, recordFeel, seenAt} from '../rig/feel'
import {target} from '../rig/targets'

// J05 + J06, both studios, two browsers on one post. J05: each types in a different
// field and sees the other's. J06: both type in the same field at once; the text
// converges with both edits in it. Throughout, nobody's focus or caret moves (F6),
// and undo takes back only your own typing, others' kept (F7; Sanity does nothing).
const ID = 'post-14'
const SEED = {title: 'Fixture post 14', excerpt: 'Short excerpt for post 14.'}
// macOS Chrome scrolls the pane on Home in an input (the caret stays); Cmd+Left is line start there.
const LINE_START = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'

const caret = (p: Page) => p.evaluate(() => ({id: document.activeElement?.id, at: (document.activeElement as HTMLInputElement | null)?.selectionStart}))
const value = (p: Page, id: string) => p.locator(`[id="${id}"]`).inputValue()

test('J05 J06: two browsers, different fields then the same field', async ({browser}, info) => {
  const t = target(info)
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto(t.docPath('post', ID)), b.goto(t.docPath('post', ID))])
    await Promise.all([t.settle(a), t.settle(b)])
    await expect(t.field(b, 'excerpt')).toHaveValue(SEED.excerpt)

    // J05: A in the title, B in the excerpt, at the same time.
    await t.field(a, 'title').click()
    await a.keyboard.press('End')
    await t.field(b, 'excerpt').click()
    await b.keyboard.press('End')
    const seenInB = seenAt(b, '[id="title"]', `${SEED.title} A`)
    const sent = Date.now()
    await Promise.all([a.keyboard.type(' A'), b.keyboard.type(' B')])
    const ms = (await seenInB) - sent
    recordFeel('F4', ms)
    await expect(t.field(a, 'excerpt')).toHaveValue(`${SEED.excerpt} B`, {timeout: 10_000})
    expect(await caret(a), 'F6: A stays at the end of its title').toEqual({id: 'title', at: `${SEED.title} A`.length})
    expect(await caret(b), 'F6: B stays at the end of its excerpt').toEqual({id: 'excerpt', at: `${SEED.excerpt} B`.length})
    console.log(`[J05 ${t.name}] A's title seen in B after ${Math.round(ms)} ms`)
    // QUALITY F4: a typed edit is seen sooner than Sanity's p95 (1104 ms).
    if (t.name === 'studio') expect(ms, 'F4 typed edit seen in 2nd browser').toBeLessThan(networkBudget(1104))

    // J06: both in the title, typing at the same moment at different ends.
    await t.field(b, 'title').click()
    await b.keyboard.press(LINE_START)
    await Promise.all([a.keyboard.type(' aaa'), b.keyboard.type('bbb ')])
    const both = `bbb ${SEED.title} A aaa`
    await expect(t.field(a, 'title')).toHaveValue(both, {timeout: 10_000})
    await expect(t.field(b, 'title')).toHaveValue(both, {timeout: 10_000})
    // F6: carets stay where each one typed. Sanity moves B's to the end here; ours must not.
    const carets = {a: await caret(a), b: await caret(b)}
    console.log(`[J06 ${t.name}] carets after merge: A ${carets.a.at}/${both.length}, B ${carets.b.at} (typed 4)`)
    if (t.name === 'studio') expect(carets, 'F6: carets stay put').toEqual({a: {id: 'title', at: both.length}, b: {id: 'title', at: 'bbb '.length}})
    expect(await value(b, 'excerpt')).toBe(`${SEED.excerpt} B`)

    // F7: A's undo takes back A's typing only; B's "bbb " stays, here and in B. Twice: " A"
    // and " aaa" are one undo step or two, by the pause between them (keys, not writes).
    await a.keyboard.press('ControlOrMeta+z')
    await a.keyboard.press('ControlOrMeta+z')
    console.log(`[F7 ${t.name}] A after undo: ${JSON.stringify(await value(a, 'title'))}`)
    if (t.name === 'studio') {
      const undone = `bbb ${SEED.title}`
      await expect(t.field(a, 'title')).toHaveValue(undone)
      await expect(t.field(b, 'title')).toHaveValue(undone, {timeout: 10_000})
    }
    // Ours coalesces writes: let the last land before the reset.
    if (t.name === 'studio') await Promise.all([a.getByText(/^Saved$/).waitFor(), b.getByText(/^Saved$/).waitFor()])
  } finally {
    await t.restore(ID, SEED)
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})

// F7: Mod+Z with the focus outside the form (a click on the pane's "Post" label) is still the
// document's undo, walking back across fields, not the browser's own undo of the last
// input (which the field then saved as a new edit, so the next Mod+Z put it back).
test('@local F7: undo with the focus outside the form is the document\'s, across fields', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours')
  await t.prepare(page.context())
  try {
    await page.goto(t.docPath('post', ID))
    await t.settle(page)
    await t.field(page, 'title').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' A')
    await page.waitForTimeout(800) // a pause: a new undo step
    await t.field(page, 'excerpt').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(' B')
    await expect(t.field(page, 'excerpt')).toHaveValue(`${SEED.excerpt} B`)
    await page.locator(`[data-pane="doc:post-14"] .kind`).first().click()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(t.field(page, 'excerpt')).toHaveValue(SEED.excerpt)
    await expect(t.field(page, 'excerpt')).toBeFocused()
    await page.locator(`[data-pane="doc:post-14"] .kind`).first().click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect(t.field(page, 'title')).toHaveValue(SEED.title)
    await page.keyboard.press('Shift+ControlOrMeta+z')
    await expect(t.field(page, 'title')).toHaveValue(`${SEED.title} A`)
    await page.getByText(/^Saved$/).waitFor()
  } finally {
    await t.restore(ID, SEED)
  }
})

// F7, as Sanity's: the document's undo walks from the form into the body and back.
// Needs Barkpark's canvas 1.10.0 (undo/redo and bp-canvas-history); an older canvas
// keeps its undo to itself, and this skips.
test('@local F7: undo walks from the form into the body; redo walks back', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours')
  await t.prepare(page.context())
  try {
    await page.goto(t.docPath('post', ID))
    await t.settle(page)
    const body = page.locator('[data-pane="doc:post-14"] .body-canvas')
    await body.getByText('Body paragraph for post 14.').click()
    const pm = body.locator('.ProseMirror')
    await expect(pm).toBeVisible({timeout: 15_000})
    test.skip(!(await page.evaluate(() => typeof (customElements.get('bp-paper-canvas')?.prototype as {undo?: unknown} | undefined)?.undo === 'function')), 'this Barkpark canvas has no undo() (1.10.0)')
    await pm.getByText('Body paragraph for post 14.').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' X')
    await expect(pm).toContainText('post 14. X')
    await page.waitForTimeout(700) // the canvas's step closes
    await t.field(page, 'title').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' T')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(t.field(page, 'title')).toHaveValue(SEED.title)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(pm).not.toContainText('post 14. X')
    await expect(pm).toBeFocused()
    await page.keyboard.press('Shift+ControlOrMeta+z')
    await expect(pm).toContainText('post 14. X')
    await page.keyboard.press('Shift+ControlOrMeta+z')
    await expect(t.field(page, 'title')).toHaveValue(`${SEED.title} T`)
    await expect(t.field(page, 'title')).toBeFocused()
  } finally {
    await t.resetDoc(ID, 'post')
  }
})
