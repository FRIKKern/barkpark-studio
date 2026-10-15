import {expect, test} from '@playwright/test'
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
    const typing = a.keyboard.type('-by-A', {delay: 90})
    // B picks up "one" by keyboard and drops it one lower, while A types.
    await b.getByRole('button', {name: 'Move item 1'}).focus()
    await b.keyboard.press('Space')
    await b.keyboard.press('ArrowDown')
    await b.keyboard.press('Space')
    await typing
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
