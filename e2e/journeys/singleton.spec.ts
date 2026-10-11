import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {bpMutate, target, closeAndSettle} from '../rig/targets'

// B13 (Barkpark-native, ours only; the Agency Studio's frontpage / siteSettings): a
// `singleton: true` type is no list. With no desk it sits under Settings and opens its
// one doc (id = the type) straight from the root, URL /structure/<type>. Its actions:
// Publish, Discard changes, History (restore) — no Duplicate, Delete or Unpublish.
// Missing, it opens empty and is created on the first edit.
const ID = 'siteSettings'
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"_id": "${ID}"`))!) as Record<string, unknown>
// The rig's writer: it waits out a 429 (the suite shares one token's budget).
const mutate = (mutations: unknown[]) => bpMutate(mutations).then(() => {})
// The seed, published, with no draft: before (a run before may have left one) and after.
const reset = async (info: Parameters<Parameters<typeof test.afterEach>[0]>[1]) => {
  if (target(info).name !== 'studio') return
  await mutate([{delete: {id: ID, type: ID, force: true}}]).catch(() => {}) // gone already is fine
  await mutate([{createOrReplace: SEED}, {publish: {id: ID, type: ID}}])
}
test.beforeEach(async ({}, info) => reset(info))
test.afterEach(async ({page}, info) => (await closeAndSettle(page), reset(info)))

test('@local B13: a singleton opens from Settings as its one doc; only publish, discard, restore', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native fixture (the reference is the Agency Studio)')
  await page.goto('/structure')
  await t.settle(page)
  const types = page.locator('[data-pane="types"]')
  await expect(types.locator('div.desk-divider')).toHaveText('Settings')
  await expect(types.getByRole('link', {name: 'Site settings'})).toBeVisible()
  await types.getByRole('link', {name: 'Site settings'}).click()
  await expect(page).toHaveURL(/\/structure\/siteSettings$/)
  await expect(page.locator('[data-pane-index]')).toHaveCount(2) // the root and the doc: no list
  await expect(page.locator('[id="tagline"]')).toHaveValue(SEED.tagline as string)
  await page.locator('[id="tagline"]').fill('Edited as a singleton')
  await page.getByRole('button', {name: 'Document actions', exact: true}).click()
  await expect(page.getByRole('menuitem')).toHaveText(['Discard changes'])
  await page.screenshot({path: 'evidence/B13-1-actions-studio.png'})
  await page.keyboard.press('Escape')
  await page.getByRole('button', {name: 'Show document actions'}).click()
  await expect(page.getByRole('menuitem', {name: 'History'})).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', {name: 'Publish', exact: true}).click()
  await expect(page.locator('.doc-footer [role=status]')).toHaveText(/^Last published/)
  await page.goto('/structure/siteSettings?perspective=published')
  await t.settle(page)
  await expect(page.locator('.doc-footer')).toContainText('Last published')
  await expect(page.getByRole('button', {name: 'Unpublish'})).toHaveCount(0)

  // Missing: it opens empty (never "not found") and the first edit creates it.
  await mutate([{delete: {id: ID, type: ID, force: true}}])
  await page.waitForTimeout(600) // past the studio server's 500 ms read dedupe (server/barkpark.ts)
  await page.goto('/structure/siteSettings')
  await t.settle(page)
  await expect(page.getByText('The document was not found')).toHaveCount(0)
  await page.locator('[id="title"]').fill('Made by its first edit')
  await expect.poll(() => t.docValue(ID, 'title', ID), {timeout: 10_000}).toBe('Made by its first edit')
  await page.screenshot({path: 'evidence/B13-2-created-studio.png'})
})
