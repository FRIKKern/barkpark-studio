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
  await expect(page.getByText('Query already saved')).toBeVisible()
  // Sanity's Update: the loaded query, changed, marks the row (a dot) and saves over it.
  await query.fill(`${text}&offset=1`)
  await expect(row.getByRole('img', {name: 'Edited'})).toBeVisible()
  await row.getByRole('button', {name: 'Update', exact: true}).click()
  await expect(row.getByRole('img', {name: 'Edited'})).toHaveCount(0)
  await expect(row.getByRole('button', {name: `Load query Mine ${marker}`})).toHaveAttribute('title', new RegExp(`${marker}&limit=3&offset=1$`))
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
test('@local J37: Vision listens to a query and shows its changes', async ({page, context}, info) => {
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
test('@local J37: Vision points at the bad part of a refused query', async ({page, context}, info) => {
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
  // A GROQ query Barkpark refuses: its parse error, at the byte it names (task-8919d95d9e581c6b).
  await query.fill('*[_type ==]')
  await query.press('ControlOrMeta+Enter')
  await expect(error).toContainText('expected an expression')
  await expect(error).toContainText(`${'-'.repeat(10)}^`)
  await expect(error).toContainText('Column: 11')
  // WCAG reflow (1280 px at 400 %): one column, scrolled down, never the page sideways.
  await page.setViewportSize({width: 320, height: 640})
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), {intervals: [50]}).toBe(320)
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
    await rowOn(b).getByRole('button', {name: 'Query actions'}).click()
    await b.getByRole('menuitem', {name: 'Share'}).click()
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
test('@local J37: Vision puts Params into the query', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's Params editor is the evidence still")
  await t.prepare(context)
  await page.goto('/vision')
  await signInIfAsked(page)
  await t.settle(page)
  // Sanity's 16 px code in the editors and the result.
  await expect(page.locator('.vision-query .cm-line').first()).toHaveCSS('font-size', '16px')
  await page.getByRole('textbox', {name: 'Query', exact: true}).fill('post?filter[title][contains]=$t&limit=$n')
  await page.getByRole('textbox', {name: 'Params', exact: true}).fill('{"t": "post 1", "n": 2}')
  await page.getByRole('button', {name: 'Fetch'}).click()
  await expect(page.getByLabel('Query URL')).toHaveValue(/filter\[title\]\[contains\]=post\+1&limit=2/)
  await page.getByRole('textbox', {name: 'Params', exact: true}).fill('{"t": "post 1"}')
  await page.getByRole('button', {name: 'Fetch'}).click()
  await expect(page.getByRole('region', {name: 'Result'}).getByRole('alert')).toHaveText('Param $n referenced, but not provided')
  // At 1024 Saved queries stays a third column beside the result, as Sanity's.
  await page.setViewportSize({width: 1024, height: 800})
  const result = (await page.getByRole('region', {name: 'Result'}).boundingBox())!
  const saved = (await page.getByRole('complementary', {name: 'Saved queries'}).boundingBox())!
  expect(saved.x).toBeGreaterThanOrEqual(result.x + result.width - 1)
  // Sanity's › hides the saved queries and brings them back.
  await page.getByRole('button', {name: 'Hide saved queries'}).click()
  await expect(page.getByRole('complementary', {name: 'Saved queries'})).toBeHidden()
  await page.getByRole('button', {name: 'Show saved queries'}).click()
  await expect(page.getByRole('complementary', {name: 'Saved queries'})).toBeVisible()
})

// task-721a16dd6310edba, as Sanity's (scout 4, 2026-10-17): a kept query runs again when
// Vision opens, after another tool, a reload or in a second tab: its result shows, never a
// blank "Execution: n/a".
test('@local J37: Vision runs its kept query again when it opens', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours; Sanity's does the same (scout 4)")
  await t.prepare(context)
  await page.goto('/vision')
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('textbox', {name: 'Query', exact: true}).fill('*[_type == "post" && _id == $id]{_id, title}')
  await page.getByRole('textbox', {name: 'Params', exact: true}).fill('{"id": "post-01"}')
  await page.getByRole('button', {name: 'Fetch'}).click()
  const result = (p = page) => p.getByRole('region', {name: 'Result'})
  await expect(result()).toContainText('Fixture post 01')
  await page.getByRole('link', {name: 'Structure', exact: true}).click()
  await page.getByRole('link', {name: 'Vision', exact: true}).click()
  await expect(result()).toContainText('Fixture post 01')
  await page.reload()
  await t.settle(page)
  await expect(result()).toContainText('Fixture post 01')
  const second = await context.newPage()
  await second.goto('/vision')
  await expect(result(second)).toContainText('Fixture post 01')
  await second.close()
})

// task-8919d95d9e581c6b: Vision speaks GROQ, as Sanity's, through Barkpark's GROQ read: a
// query with a $param from Params, its result (not the {query, result, ms} wrapper) and
// the Query URL naming the GROQ address. Both studios, the same query.
test('@local J37: Vision runs GROQ with params, as Sanity\'s', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto('/vision')
  await signInIfAsked(page)
  if (t.name === 'studio') await expect(page.getByRole('combobox', {name: 'Dataset', exact: true})).toBeEnabled()
  const editors = page.locator('.cm-content')
  const put = async (i: number, text: string) => {
    await editors.nth(i).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText(text) // no auto-closed brackets
  }
  await put(0, '*[_type == "post" && title match $t] | order(title asc)[0...2]{title}')
  await put(1, '{"t": "Fixture post 0*"}')
  await page.waitForTimeout(500) // Sanity reads its params a beat after the last key
  await page.getByRole('button', {name: 'Fetch', exact: true}).click()
  const result = page.getByRole('region', {name: 'Result'}).or(page.locator('[data-testid="vision-result"]')).first()
  await expect(page.getByText('Fixture post 01').first()).toBeVisible({timeout: 15_000})
  await expect(page.getByText('Fixture post 02').first()).toBeVisible()
  if (t.name === 'studio') {
    await expect(page.locator('#vision-url')).toHaveValue(/\/v\d{4}-\d{2}-\d{2}\/data\/query\/[^/?]+\?query=/)
    await expect(result).not.toContainText('syncTags')
  }
})
