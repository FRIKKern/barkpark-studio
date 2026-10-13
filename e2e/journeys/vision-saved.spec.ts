import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J37, Vision as Sanity's: saved queries are the editor's own, kept on the server (they
// survive a reload), renamed by their title and deleted from their menu; and Vision
// reads another dataset of the project. Shared queries: Share and Unshare move one between
// the editor's prefs and the dataset. Sanity's side is the J37 evidence stills.
test('J37: Vision saves, renames, loads, shares, unshares and deletes a query, and switches dataset', async ({page, context}, info) => {
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
  await page.getByRole('menuitem', {name: 'Save as personal'}).click()
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
  await expect(query).toHaveText(text) // the code editor (contenteditable) shows the loaded query
  await saved.getByRole('button', {name: 'Save query'}).click()
  await page.getByRole('menuitem', {name: 'Save as personal'}).click()
  await expect(page.getByText('Query already saved')).toBeVisible()
  // Shared: Share moves it to the team (a document in the dataset), Unshare brings it back.
  await row.getByRole('button', {name: 'Query actions'}).click()
  await page.getByRole('menuitem', {name: 'Share'}).click()
  await page.getByRole('dialog').getByRole('button', {name: 'Save as shared'}).click()
  // A write to the dataset (create + publish), then the list: on CI it once took over 5 s
  // (#486, 1 in about 60 runs, no 429 logged; the server now logs slow Barkpark calls).
  await expect(page.getByText('Shared query saved')).toBeVisible({timeout: 10_000})
  await saved.getByRole('tab', {name: 'Shared'}).click()
  await expect(row.getByText('Shared', {exact: true})).toBeVisible()
  await row.getByRole('button', {name: 'Query actions'}).click()
  await page.getByRole('menuitem', {name: 'Unshare'}).click()
  await expect(page.getByText('Query moved to personal')).toBeVisible()
  await expect(row).toHaveCount(0)
  await saved.getByRole('tab', {name: 'Personal'}).click()
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

// A refused query: Barkpark's message, and the bad part of the query marked (Sanity's
// dash line and carets, line and column).
test('J37: Vision points at the bad part of a refused query', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.goto('/vision')
  await signInIfAsked(page)
  await expect(page.getByRole('combobox', {name: 'Dataset', exact: true})).toBeEnabled()
  const query = page.getByLabel('Query', {exact: true})
  await query.fill('post?filter[title][bogus]=x&limit=1')
  await query.press('ControlOrMeta+Enter')
  const error = page.getByRole('region', {name: 'Result'}).getByRole('alert')
  await expect(error).toContainText('unknown filter operator "bogus"')
  await expect(error).toContainText(`-----${'^'.repeat(22)}`)
  await expect(error).toContainText('Column: 6')
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

// Shared queries are live, as Sanity's: one editor shares a query and another's open
// Vision lists it without a reload; unsharing takes it away again.
test('@local J37: a query shared in one browser shows in another at once', async ({browser}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  const marker = `j37-live-${Date.now().toString(36)}`
  try {
    await Promise.all([a.goto('/vision'), b.goto('/vision')])
    await Promise.all([signInIfAsked(a), signInIfAsked(b)])
    await Promise.all([a, b].map((p) => expect(p.getByRole('combobox', {name: 'Dataset', exact: true})).toBeEnabled()))
    const rowOn = (p: typeof a) => p.getByRole('complementary', {name: 'Saved queries'}).getByRole('listitem').filter({hasText: marker})
    await b.getByLabel('Query', {exact: true}).fill(`post?filter[title][contains]=${marker}`)
    await b.getByRole('complementary', {name: 'Saved queries'}).getByRole('button', {name: 'Save query'}).click()
    await b.getByRole('menuitem', {name: 'Save as shared'}).click()
    await b.getByRole('dialog').getByRole('button', {name: 'Save as shared'}).click()
    await expect(rowOn(a)).toBeVisible()
    await rowOn(b).getByRole('button', {name: 'Query actions'}).click()
    await b.getByRole('menuitem', {name: 'Delete'}).click()
    await expect(rowOn(a)).toHaveCount(0)
  } finally {
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})

// J37, Sanity's Params: $name in the query takes its value from the Params JSON, as the
// Query URL shows; a name Params don't have is said, not sent. Nothing is written.
test('J37: Vision puts Params into the query', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's Params editor is the evidence still")
  await t.prepare(context)
  await page.goto('/vision')
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('textbox', {name: 'Query', exact: true}).fill('post?filter[title][contains]=$t&limit=$n')
  await page.getByRole('textbox', {name: 'Params', exact: true}).fill('{"t": "post 1", "n": 2}')
  await page.getByRole('button', {name: '▶ Fetch'}).click()
  await expect(page.getByLabel('Query URL')).toHaveValue(/filter\[title\]\[contains\]=post\+1&limit=2/)
  await page.getByRole('textbox', {name: 'Params', exact: true}).fill('{"t": "post 1"}')
  await page.getByRole('button', {name: '▶ Fetch'}).click()
  await expect(page.getByRole('region', {name: 'Result'}).getByRole('alert')).toHaveText('Param $n referenced, but not provided')
})
