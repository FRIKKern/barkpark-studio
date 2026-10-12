import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J69 guard (a CI gate): Help > Diagnostics runs its connection tests (the live stream
// twice, the studio server, Barkpark's API and media) and every one passes on a healthy
// studio; Copy output is JSON in Sanity's top-level shape. Nothing is written.
test('J69: Diagnostics runs its connection tests and copies JSON', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's dialog is the evidence still")
  await t.prepare(context)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('button', {name: 'Help and resources'}).click()
  await page.getByRole('menuitem', {name: 'Diagnostics'}).click()
  const dialog = page.getByRole('dialog', {name: 'Studio diagnostics'})
  const copy = dialog.getByRole('button', {name: 'Copy output'})
  await expect(copy).toBeEnabled({timeout: 15_000})
  await expect(dialog.locator('.diagnostics-status[data-status="error"]')).toHaveCount(0)
  await expect(dialog.locator('.diagnostics-status[data-status="success"]')).toHaveCount(8) // 2 live stream + 6 requests
  await copy.click()
  const json = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
  expect(Object.keys(json)).toEqual(['diagnosticVersion', 'startedAt', 'generatedAt', 'durationMs', 'studio', 'schema', 'user', 'browser', 'network'])
  expect(json.network.listen.first.status).toBe('success')
})
