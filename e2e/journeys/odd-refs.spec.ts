import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// J27, both studios: odd reference states. A reference to a doc that is gone
// (Clear fixes it), one to a never-published draft (flagged, blocks publish), a
// filtered reference (search hides what the filter excludes), and a reference
// with two target types ("Create…" asks which).
const ID = 'post-27'
const DRAFT = 'author-draftonly'
const seed = readFileSync(new URL('../../fixtures/seed.ndjson', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .find((d) => d._id === ID)

test.afterEach(async ({page}, info) => {
  const t = target(info)
  await page.close()
  await t.restore(ID, {author: t.ref(seed.author._ref)}, 'post', ['reviewer'])
  await t.deleteDoc(DRAFT, 'author')
})

test('@local J27: missing doc + Clear, draft-only target, filtered search, create asks the type', async ({page}, info) => {
  const t = target(info)
  await t.draftOnly(DRAFT, 'author', {name: 'Draft Only'})
  await t.patch(ID, {author: t.weakRef('author-missing'), reviewer: t.weakRef(DRAFT, 'author')})
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const pane = t.pane(page, 2)

  // Missing: a red card that says so, and why on hover.
  const unavailable = pane.getByText('Document unavailable')
  await expect(unavailable).toBeVisible()
  await unavailable.locator('xpath=following::*[name()="svg"][1]').hover()
  await expect(page.getByText(/referenced document does not exist \(ID: author-missing\)/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText(/referenced document does not exist \(ID: author-missing\)/)).toBeHidden()

  // Both odd references fail validation, with Sanity's wording.
  await page.getByRole('button', {name: 'Validation'}).click()
  await expect(page.getByText('Referenced document must be published').filter({visible: true})).toHaveCount(2)

  // Clear the missing one: the field is empty and searchable again.
  await t.unavailableRefMenu(pane).click()
  await page.getByRole('menuitem', {name: 'Clear'}).click()
  await expect(unavailable).toBeHidden()
  await expect(t.field(page, 'author')).toBeVisible()

  // Draft-only target: shown, still flagged.
  await page.getByRole('tab', {name: 'Meta'}).click()
  await expect(pane.getByText('Draft Only').first()).toBeVisible()

  // Filtered: the reviewer filter leaves Alan out.
  await t.refMenu(pane, 'reviewer').click()
  await page.getByRole('menuitem', {name: 'Replace'}).click()
  await t.field(page, 'reviewer').fill('Alan')
  await expect(page.getByText(/No results for .Alan/).filter({visible: true})).toBeVisible()
  await t.field(page, 'reviewer').fill('Grace')
  await expect(page.getByRole('option', {name: /^Grace Hopper/})).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // Two target types: Create asks which.
  await pane.getByRole('button', {name: /^Create(…|\.\.\.)$/}).click()
  await expect(page.getByRole('menuitem', {name: 'Post', exact: true})).toBeVisible()
  await expect(page.getByRole('menuitem', {name: 'Post by Alan Turing'})).toBeVisible() // J18: its template too
  await expect(page.getByRole('menuitem', {name: /^Aut/})).toBeVisible()
  await page.keyboard.press('Escape')
  // Ours coalesces writes: let the Clear land before the reset.
  if (t.name === 'studio') await page.getByText(/^Saved$/).waitFor()
})
