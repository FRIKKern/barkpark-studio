import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J37, Vision as Sanity's: saved queries are the editor's own, kept on the server (they
// survive a reload), renamed by their title and deleted from their menu; and Vision
// reads another dataset of the project. Sanity's side is the J37 evidence stills.
test('J37: Vision saves, renames, loads and deletes a query, and switches dataset', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.goto('/vision')
  await signInIfAsked(page)
  const marker = `j37-${Date.now().toString(36)}`
  const text = `post?filter[title][contains]=${marker}&limit=3`
  const query = page.getByLabel('Query', {exact: true})
  // Hydrated (the remembered query is in) once the project's datasets are listed.
  await expect(page.getByRole('combobox', {name: 'Dataset', exact: true})).toBeEnabled()
  const saved = page.getByRole('complementary', {name: 'Saved queries'})
  const row = saved.getByRole('listitem').filter({hasText: marker})
  await query.fill(text)
  await saved.getByRole('button', {name: 'Save query'}).click()
  await expect(page.getByText('Query saved')).toBeVisible()
  await row.getByRole('button', {name: 'Untitled', exact: true}).click()
  await row.getByLabel('Title', {exact: true}).fill(`Mine ${marker}`)
  // The rename is stored (a POST to the prefs server function) before the reload.
  const stored = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('_serverFn'))
  await row.getByLabel('Title', {exact: true}).press('Enter')
  await expect(row.getByRole('button', {name: `Mine ${marker}`, exact: true})).toBeVisible()
  await stored

  // On the server: still there after a reload; loading it fills the query.
  await page.reload()
  await expect(page.getByRole('combobox', {name: 'Dataset', exact: true})).toBeEnabled()
  await query.fill('author')
  await saved.getByRole('searchbox', {name: 'Search queries'}).fill(marker)
  await row.getByRole('button', {name: `Load query Mine ${marker}`}).click()
  await expect(query).toHaveValue(text)
  await saved.getByRole('button', {name: 'Save query'}).click()
  await expect(page.getByText('Query already saved')).toBeVisible()
  await row.getByRole('button', {name: 'Query actions'}).click()
  await page.getByRole('menuitem', {name: 'Delete'}).click()
  await expect(row).toHaveCount(0)

  // Another dataset of the project (not production): the query runs there.
  const select = page.getByRole('combobox', {name: 'Dataset', exact: true})
  const here = await select.inputValue()
  const other = (await select.locator('option:not([disabled])').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).find((v) => v !== here && v !== 'production')!
  expect(other, 'the project has another dataset').toBeTruthy()
  await select.selectOption(other)
  await query.fill('post?limit=1')
  await query.press('ControlOrMeta+Enter')
  await expect(page.getByLabel('Query URL')).toHaveValue(new RegExp(`/v1/data/query/${other}/post\\?`))
  await expect(page.getByRole('region', {name: 'Result'})).toContainText('documents')
})

// Listen: the query's changes as they happen (Barkpark's listen stream, narrowed by the
// query's type and equality filter), newest first, until Stop.
test('J37: Vision listens to a query and shows its changes', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  const id = `post-listen-${Date.now().toString(36)}`
  await t.draftOnly(id, 'post', {title: 'Listen probe'})
  try {
    await t.prepare(context)
    await page.goto('/vision')
    await signInIfAsked(page)
    await expect(page.getByRole('combobox', {name: 'Dataset', exact: true})).toBeEnabled()
    await page.getByLabel('Query', {exact: true}).fill(`post?filter[title]=Listen probe`)
    await page.getByRole('button', {name: 'Listen'}).click()
    const result = page.getByRole('region', {name: 'Result'})
    await expect(result).toContainText('Listening for changes')
    await t.patch(id, {excerpt: 'heard'})
    await expect(result).toContainText(`drafts.${id}`)
    await page.getByRole('button', {name: 'Stop'}).click()
    await expect(page.getByRole('button', {name: 'Listen'})).toBeVisible()
  } finally {
    await t.deleteDoc(id, 'post')
  }
})

test('@evidence J37: Vision saved queries and dataset, side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto('/vision')
  await signInIfAsked(page)
  await page.getByText('Saved queries').first().waitFor({timeout: 60_000})
  // Ours: one saved query to show (removed after the still).
  if (t.name === 'studio') {
    await expect(page.getByRole('combobox', {name: 'Dataset', exact: true})).toBeEnabled()
    await page.getByLabel('Query', {exact: true}).fill('post?filter[title][contains]=post&limit=5')
    await page.getByRole('button', {name: 'Save query'}).click()
  }
  await page.waitForTimeout(1500)
  await page.screenshot({path: `evidence/J37-${t.name}-5-saved-queries.png`})
  if (t.name === 'studio') {
    await page.getByRole('button', {name: 'Query actions'}).first().click()
    await page.getByRole('menuitem', {name: 'Delete'}).click()
  }
})
