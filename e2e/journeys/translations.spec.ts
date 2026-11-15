import {expect, test} from '../rig/test'
import {bpMutate, closeAndSettle, signInIfAsked, target} from '../rig/targets'

// Document translations (Sanity's @sanity/document-internationalization), ours: a type
// whose schema carries `desk.translations` (the fixture `volume`: nb, en). What can break
// silently: the menu stops creating a linked translation, the new document does not open in
// the next pane, the group goes stale after a delete (a dead link instead of "Create new").
// Its own scratch volume, so no fixture is edited.
//
// It runs in CI on a PR that changes the fixture schemas (the studio reads them from the
// checkout) and on a dataset seeded with them; on a dataset whose `volume` schema has no
// `desk.translations` yet (the CI pool until it is reseeded with --schemas) it skips.
const ID = `e2e-translated-${Date.now().toString(36)}`
const TITLE = 'Translated scratch volume'
let made: string | undefined

const remove = (id: string, type: string) => bpMutate([{delete: {id, type, ifExists: true}}]).then(() => {}, () => {})
test.afterEach(async ({page}) => {
  await closeAndSettle(page)
  // The group's metadata, the translation, the scratch volume: all this spec made.
  await remove(`translations-${ID}`, 'translation.metadata')
  if (made) await remove(made, 'volume')
  await remove(ID, 'volume')
})

test('translations: create the other language, it opens linked in the next pane; delete it, creatable again', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "Barkpark-native: Sanity's is the plugin, not installed in the reference")
  await bpMutate([{create: {_id: ID, _type: 'volume', title: TITLE, language: 'nb'}}])
  await page.goto(t.docPath('volume', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const source = t.pane(page, 2)
  await expect(t.field(page, 'title')).toHaveValue(TITLE)
  const menuButton = source.getByRole('button', {name: 'Translations'})
  test.skip(!(await menuButton.isVisible()), "this dataset's volume schema has no desk.translations yet (reseed with --schemas)")

  // The language is the header's badge, never a form field.
  await expect(source.getByTestId('language-badge')).toHaveText('nb')
  await expect(source.locator('[id="language"]')).toHaveCount(0)
  await menuButton.click()
  await expect(page.getByRole('menuitem', {name: 'Norsk bokmål: current document'})).toBeVisible()
  await page.getByRole('menuitem', {name: 'Create new English translation'}).click()

  // The translation opens in the next pane: a copy of the source, in its own language, in the URL.
  const translation = t.pane(page, 3)
  await expect(translation.getByTestId('language-badge')).toHaveText('en')
  await expect(translation.locator('[id="title"]')).toHaveValue(TITLE)
  made = decodeURIComponent(new URL(page.url()).pathname).split(';').pop()!.split(',')[0]
  expect(made).not.toBe(ID)

  // Both documents now list both: each offers the other, neither offers to create it again.
  await menuButton.click()
  await expect(page.getByRole('menuitem', {name: 'Open English translation'})).toBeVisible()
  await expect(page.getByRole('menuitem', {name: 'Create new English translation'})).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(menuButton).toBeFocused()
  await translation.getByRole('button', {name: 'Translations'}).click()
  await expect(page.getByRole('menuitem', {name: 'Open Norsk bokmål translation'})).toBeVisible()
  await page.keyboard.press('Escape')

  // Delete the translation: it leaves the group, and the source offers to create it again.
  await translation.getByRole('button', {name: 'Open document actions'}).click()
  await page.getByRole('menuitem', {name: 'Delete'}).click()
  await page.getByRole('dialog').getByRole('button', {name: 'Delete document'}).click()
  await expect(translation).toHaveCount(0)
  await menuButton.click()
  await expect(page.getByRole('menuitem', {name: 'Create new English translation'})).toBeVisible()
  await expect(page.getByRole('menuitem', {name: 'Manage translations'})).toBeDisabled()
})
