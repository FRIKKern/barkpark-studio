import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// Screen-reader scout (task-439d714d1ef00cec): the document footer's live region says only a
// change of save state (Saving… / Saved / Not saved), once. The relative time ("Edited 7 min.
// ago", rewritten every minute) and the editor's initial stay outside it, so an idle draft
// says nothing. Draft-only scratch post, deleted after.
test('footer: the live region says only save-state changes, never the relative time or the initial', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's footer says nothing on save")
  const id = `post-footer-live-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'Footer live', slug: {_type: 'slug', current: id}})
  try {
    await page.goto(t.docPath('post', id))
    await t.settle(page)
    const footer = page.locator('.doc-footer')
    const live = footer.locator('[role=status], [aria-live]')
    await expect(footer.locator('.save-state-text')).toHaveText(/Edited|Last published/)
    // The visible words, and the initial beside them, are in no live region.
    for (const sel of ['.save-state-text', '.save-state']) {
      expect(await footer.locator(sel).first().evaluate((el) => !!el.closest('[role=status], [role=alert], [aria-live]')), sel).toBe(false)
    }
    await expect(live).toHaveCount(1)
    await expect(live).toHaveText('')
    // An edit: the region says the state, never the time.
    const said = new Set<string>()
    await live.evaluate((el) => new MutationObserver(() => ((window as unknown as {said: string[]}).said ??= []).push(el.textContent ?? '')).observe(el, {childList: true, subtree: true, characterData: true}))
    await t.field(page, 'title').fill('Footer live, edited')
    await expect(footer.locator('.save-state-text')).toHaveText(/Saved|Edited/, {timeout: 15_000})
    await page.waitForTimeout(3500) // past "Saved"
    for (const s of await page.evaluate(() => (window as unknown as {said?: string[]}).said ?? [])) said.add(s)
    expect([...said].filter((s) => s && !['Saving…', 'Saved'].includes(s)), [...said].join(' | ')).toEqual([])
    expect(said.has('Saved') || said.has('Saving…'), [...said].join(' | ')).toBe(true)
  } finally {
    await t.deleteDoc(id, 'post')
  }
})

// A toast is one live region (its own role=status, or alert when critical), as Sanity's one
// role=alert: inside an aria-live container some readers said it twice. Nothing is written.
test('a toast sits in exactly one live region', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours')
  await t.prepare(context)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/structure')
  await t.settle(page)
  await page.getByRole('button', {name: 'Help and resources'}).click()
  await page.getByRole('menuitem', {name: 'Diagnostics'}).click()
  const copy = page.getByRole('dialog', {name: 'Studio diagnostics'}).getByRole('button', {name: 'Copy output'})
  await expect(copy).toBeEnabled({timeout: 15_000})
  await copy.click()
  const toast = page.locator('.toast', {hasText: 'Diagnostics copied to clipboard'})
  await expect(toast).toBeVisible()
  expect(await toast.evaluate((el) => {
    let regions = 0
    for (let e: Element | null = el; e; e = e.parentElement) if (e.getAttribute('aria-live') || ['status', 'alert', 'log'].includes(e.getAttribute('role') ?? '')) regions++
    return regions
  })).toBe(1)
})
