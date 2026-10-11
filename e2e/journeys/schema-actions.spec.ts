import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// B10: a schema-declared action (fixtures/barkpark-schema/volume.json declares
// OnixEdit's publish_to_bokbasen as "Send to Bokbasen") sits in the footer's "…"
// menu and opens Barkpark's two-step confirm. A volume is not a book, so the
// plugin's dry-run refuses it: the refusal shows, and "for real" is never offered.
// @local: the route is admin tier (as in LiveView) and CI's studio-parity token is not
// an admin, so CI sees no schema actions.
test('@local B10: a schema action asks, runs a dry-run, shows its answer', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: Sanity has no schema-declared actions')
  // The studio's own token decides (a lane's member token, e2e/run.mjs, sees none either).
  const self = await fetch(`${process.env.BARKPARK_URL}/v1/auth/token`, {headers: {authorization: `Bearer ${process.env.BARKPARK_APP_TOKEN ?? process.env.BARKPARK_TOKEN}`}}).then((r) => r.json() as Promise<{seat?: {role?: string}}>)
  test.skip(self.seat?.role !== 'admin', "the studio's token is not an admin: no schema actions to show")
  await t.prepare(context)
  await page.goto(t.docPath('volume', 'volume-01'))
  await signInIfAsked(page)
  await t.settle(page)
  await t.docMenu(page).click()
  await page.getByRole('menuitem', {name: 'Send to Bokbasen'}).click()
  const dialog = page.getByRole('dialog', {name: 'Send to Bokbasen?'})
  await expect(dialog).toContainText("We'll run a dry-run first, then ask again before sending for real.")
  await dialog.getByRole('button', {name: 'Confirm', exact: true}).click()
  await expect(dialog.getByRole('alert')).toHaveText('Dry-run failed: No document loaded')
  await expect(dialog.getByRole('button', {name: 'Confirm for real'})).toHaveCount(0)
  await dialog.getByRole('button', {name: 'Cancel'}).click()
  await expect(dialog).toBeHidden()
})
