import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// B04 evidence, ours (the reference is Barkpark's LiveView Studio, not Sanity):
// every field of the Barkpark-native fixture type renders sanely — colour picker,
// read-only JSON and source, number keyboards, codes, per-language text — and no
// value ever shows as "[object Object]". Full (volume-01) and near-empty
// (volume-03) docs, both tabs. Stills + a clip go to e2e/evidence/. Not a CI gate.
test.use({video: 'on'})

test('@evidence B04: every Barkpark field type renders sanely', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only type; the reference is the LiveView Studio')
  for (const id of ['volume-01', 'volume-03']) {
    await page.goto(t.docPath('volume', id))
    await t.settle(page)
    const pane = t.pane(page, 2)
    for (const group of ['Main', 'Metadata']) {
      await page.getByRole('tab', {name: group}).click()
      await expect(pane).not.toContainText('[object Object]')
      await pane.screenshot({path: `evidence/B04-studio-${id}-${group.toLowerCase()}.png`, fullPage: true})
    }
  }
  // volume-01's values, each in its own kind of input.
  await page.goto(t.docPath('volume', 'volume-01'))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Main'}).click()
  await expect(t.field(page, 'blurb.nob')).toHaveValue('En bok om felter.')
  await expect(t.field(page, 'subject')).toHaveValue('FBA')
  await expect(page.getByRole('button', {name: /Ada Lovelace/})).toBeVisible() // contributors: preview rows
  await page.getByRole('tab', {name: 'Metadata'}).click()
  await expect(t.field(page, 'coverColor')).toHaveValue('#2f3f9e')
  await expect(t.field(page, 'pages')).toHaveAttribute('inputmode', 'numeric')
  await expect(t.field(page, 'price')).toHaveAttribute('inputmode', 'decimal')
  await expect(t.field(page, 'releaseDate')).toHaveValue('2026-11-01')
  await expect(page.locator('[id="metadata"] pre')).toContainText('"printRun": 3000')
  await expect(page.locator('[id="onixSource"] pre')).toContainText('<RecordReference>volume-01</RecordReference>')
  await page.locator('[id="onixSource"]').scrollIntoViewIfNeeded()
  await t.pane(page, 2).screenshot({path: 'evidence/B04-studio-volume-01-json-source.png'})
  await page.getByRole('tab', {name: 'Main'}).click()
  await page.getByRole('button', {name: /Ada Lovelace/}).scrollIntoViewIfNeeded()
  await t.pane(page, 2).screenshot({path: 'evidence/B04-studio-volume-01-codes-contributors.png'})
})
