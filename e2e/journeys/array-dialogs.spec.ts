import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// Arrays as Sanity's, on fieldTypes' "blocks" (six member types) and "sections" (items
// inside items; fixtures/barkpark-schema/fieldTypes.json). @local: CI's datasets get the
// fixture schema only when a PR changes it. Opens a new document (no write until an edit;
// the add below makes one, removed after).
test('@local arrays: a six-type insert menu searches; a nested item dialog names the whole way', async ({page}, info) => {
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
  } finally {
    await t.deleteDoc(id, 'fieldTypes').catch(() => {})
  }
})
