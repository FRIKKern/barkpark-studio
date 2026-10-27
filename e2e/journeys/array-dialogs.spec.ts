import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// Arrays as Sanity's, on fieldTypes' "blocks" (six member types) and "sections" (items
// inside items; fixtures/barkpark-schema/fieldTypes.json). @local: CI's datasets get the
// fixture schema only when a PR changes it. Opens a new document (no write until an edit;
// the add below makes one, removed after).
test('@local arrays: a six-type insert menu searches; a nested item dialog names the whole way stays shut when its outer one reopens, and survives a reload', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's is the scout's still")
  await t.prepare(page.context())
  await page.goto('/intent/create/type=fieldTypes')
  await signInIfAsked(page)
  await expect(page).toHaveURL(/\/structure\/fieldTypes;([0-9a-f-]{36})/)
  const id = page.url().match(/fieldTypes;([0-9a-f-]{36})/)![1]!
  try {
    const field = (n: string) => page.locator(`[id="${n}"]`).locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " field ")][1]')
    await field('blocks').getByRole('button', {name: 'Add item...'}).click()
    const search = page.getByRole('searchbox', {name: 'Search', exact: true})
    await expect(search).toBeFocused()
    await search.fill('fa')
    await expect(page.getByRole('menuitem')).toHaveText(['FAQ'])
    await page.keyboard.press('Escape')
    await field('sections').getByRole('button', {name: 'Add item', exact: true}).click()
    await page.getByRole('dialog', {name: /^Sections \//}).getByRole('button', {name: 'Add item', exact: true}).click()
    await expect(page.getByRole('dialog').last().getByRole('navigation', {name: 'Breadcrumb'})).toHaveText(/^Sections\s*\/\s*#1 Untitled\s*\/\s*Items\s*\/\s*#1 Untitled$/)
    // Closed by Escape with the URL still naming a field in it, the inner item stays closed
    // when the outer one is opened again by hand, as Sanity's.
    await page.getByRole('dialog', {name: /^Items \//}).locator('[id$=".label"]').click()
    await expect(page).toHaveURL(/path=sections.*items.*label/)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await field('sections').getByText('Untitled', {exact: true}).click()
    await expect(page.getByRole('dialog', {name: /^Sections \//})).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    // Opened by hand, an item names itself in the URL, so a reload brings both back (Sanity's).
    await page.getByRole('dialog', {name: /^Sections \//}).getByRole('button', {name: 'Untitled', exact: true}).click()
    await expect.poll(() => decodeURIComponent(page.url())).toMatch(/path=sections\[_key=="\w+"\]\.items\[_key=="\w+"\]$/)
    await page.reload()
    await signInIfAsked(page)
    await expect(page.getByRole('dialog')).toHaveCount(2)
    // A long unbroken title stays on one line in the crumb, cut with an ellipsis, and Close stays
    // in the dialog (Sanity's crumb is at most 250 px; ours wrapped and pushed Close out).
    const inner = page.getByRole('dialog', {name: /^Items \//})
    await inner.locator('[id$=".label"]').fill(`Long${'Supercalifragilistic'.repeat(5)}`)
    const crumb = inner.locator('.crumb.current')
    await expect(crumb).toContainText('LongSupercalifragilistic')
    expect((await crumb.boundingBox())!.width).toBeLessThanOrEqual(250)
    expect((await crumb.boundingBox())!.height).toBeLessThan(30)
    const box = (await inner.boundingBox())!
    const close = (await inner.getByRole('button', {name: 'Close dialog'}).boundingBox())!
    expect(close.x + close.width).toBeLessThanOrEqual(box.x + box.width)
  } finally {
    await t.deleteDoc(id, 'fieldTypes').catch(() => {})
  }
})

// task-eaba30ae6be378be: with a field named in the URL (path=title, as typing in it writes), Add item by
// keyboard opened the new item's dialog, then a re-render on the save focused the named field
// behind it and wrote path=title back: keyboard focus left the dialog. As Sanity's, focus
// stays in the dialog and the URL names the item.
test('@local arrays: Add item by keyboard keeps focus in the new item dialog when the URL names another field', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: the URL path= follower')
  await t.prepare(page.context())
  await page.goto('/intent/create/type=fieldTypes')
  await signInIfAsked(page)
  await expect(page).toHaveURL(/\/structure\/fieldTypes;([0-9a-f-]{36})/)
  const id = page.url().match(/fieldTypes;([0-9a-f-]{36})/)![1]!
  try {
    await t.field(page, 'title').focus()
    await page.keyboard.type('Path probe')
    await page.keyboard.press('Tab') // focus moves on: the URL follows it (the next field)
    await page.keyboard.press('Shift+Tab')
    await expect(page).toHaveURL(/[,;]path=title(?:[,&]|$)/)
    const add = page.locator('[id="sections"]').getByRole('button', {name: 'Add item', exact: true})
    await add.focus()
    await page.evaluate(() => {
      const w = window as unknown as {out?: number}
      w.out = 0
      const until = performance.now() + 2000
      const frame = () => {
        if (document.querySelector('[role=dialog]') && !document.activeElement?.closest('[role=dialog]')) w.out!++
        if (performance.now() < until) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', {name: /^Sections \//})).toBeVisible()
    await page.waitForTimeout(2100)
    expect(await page.evaluate(() => (window as unknown as {out: number}).out)).toBe(0)
    await expect(page).toHaveURL(/path=sections/)
  } finally {
    await t.deleteDoc(id, 'fieldTypes').catch(() => {})
  }
})
