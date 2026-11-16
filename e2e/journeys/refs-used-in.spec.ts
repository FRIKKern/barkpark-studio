import {expect, test, type Route} from '../rig/test'
import {installProbes, sharedLocalToken} from '../rig/feel'
import {bpBase, bpDataset, bpMutate, target, closeAndSettle} from '../rig/targets'
import {referenceHold} from '../rig/reference'

// The URL costs nothing to read: every 50 ms, not the default backoff.
const PAGE_POLL = {intervals: [50]}

// J17, where a referenced doc is used: Delete names the docs that refer to it, and the
// document menu's Incoming references lists them, live. Same steps on both studios. Split
// from refs.spec for CI's shards (task-c1df532bed870536).
const ID = 'post-07' // author: Alan Turing

test.beforeEach(async ({context}, info) => {
  await Promise.all([target(info).prepare(context), installProbes(context)])
})
let alanEdited = false
let post02Moved = false
test.afterEach(async ({page}, info) => {
  const t = target(info)
  await closeAndSettle(page)
  // Each a different doc: all at once.
  await Promise.all([
    t.restore(ID, {author: t.ref('author-alan')}),
    alanEdited && t.restore('author-alan', {bio: 'Alan Turing writes fixture posts.'}, 'author'),
    post02Moved && t.restore('post-02', {author: t.ref('author-grace')}),
  ])
  post02Moved = false
  alanEdited = false
})

test('J17: deleting a referenced author shows where it is used', async ({page}, info) => {
  const t = target(info)
  await page.goto(t.docPath('author', 'author-alan'))
  await t.settle(page)
  await referenceHold(page, t.field(page, 'name'), 'Alan Turing')
  // Reads fail until let go: let go only as Retry is pressed, so no other read (a live
  // frame's "used in" refresh, CI ef7d9e8) can answer first and take the Retry button away.
  let failReads = true
  let holdReads = false // failing reads wait here until let go, so a re-read is seen in flight
  const held: Route[] = []
  if (t.name === 'studio') {
    await expect(t.field(page, 'name')).toHaveValue('Alan Turing')
    await page.route('**/_serverFn/**', (route) => {
      if (!failReads || route.request().method() !== 'GET') return route.continue()
      if (holdReads) return void held.push(route)
      return route.abort('failed')
    })
  }
  await t.docMenu(page).click()
  await referenceHold(page, page.getByRole('menuitem', {name: 'Delete'}))
  await page.getByRole('menuitem', {name: 'Delete'}).click()
  const dialog = page.getByRole('dialog').last()
  if (t.name === 'studio') {
    await expect(dialog.getByRole('alert')).toContainText('Could not check where this document is used')
    await expect(dialog.getByRole('button', {name: 'Delete document'})).toBeDisabled()
    const retry = dialog.getByRole('button', {name: 'Retry', exact: true})
    await retry.focus()
    // Someone saves Alan meanwhile: its live frame has "used in" read again behind the error,
    // and Retry keeps the focus through that read (it unmounted for it, and Enter went
    // nowhere: #829's CI, 2026-10-16).
    holdReads = true
    alanEdited = true
    await t.patch('author-alan', {bio: `Edited meanwhile ${Date.now()}`}, 'author')
    const rereading = dialog.getByText('Looking for documents that refer to it…')
    await expect(rereading).toBeVisible({timeout: 10_000})
    await expect(retry).toBeFocused()
    holdReads = false
    for (const r of held.splice(0)) await r.abort('failed').catch(() => {})
    await expect(rereading).toBeHidden() // that read failed too: the error stands
    await expect(retry).toBeFocused()
    failReads = false
    await page.keyboard.press('Enter')
    await page.unrouteAll({behavior: 'wait'})
    await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused()
  }
  await expect(dialog).toContainText('10 documents refer to “Alan Turing”')
  await expect(dialog).toContainText('Fixture post 01')
  await referenceHold(page, dialog)
  if (t.name === 'studio') {
    // Refuse the write before it reaches the API; a failed delete must keep focus. Reads
    // are slowed, and a live frame (someone saves a referring post) makes the dialog read
    // "used in" again meanwhile: the buttons must hold still through that re-read (it
    // disabled Delete under the caret, and Enter went to Close: CI, 2026-10-09).
    let reading!: () => void
    const reread = new Promise<void>((r) => (reading = r))
    await page.route('**/_serverFn/**', async (route) => {
      if (route.request().method() === 'POST') return route.abort('failed')
      if (!decodeURIComponent(route.request().url()).includes('author-alan')) return route.continue().catch(() => {})
      reading() // the "used in" read for Alan
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue().catch(() => {})
    })
    alanEdited = true
    await t.patch('author-alan', {bio: `Edited meanwhile ${Date.now()}`}, 'author') // someone saves Alan (afterEach puts it back)
    await reread // the dialog is reading "used in" again right now
    const anyway = dialog.getByRole('button', {name: 'Delete anyway'})
    await expect(anyway).toBeEnabled({timeout: 100})
    await anyway.focus()
    await expect(anyway).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('alert')).toContainText('Could not delete')
    await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused()
    await page.unrouteAll({behavior: 'ignoreErrors'})
  }
  await dialog.getByRole('button', {name: 'Cancel'}).click()
  await expect(dialog).toBeHidden()
  await expect(t.field(page, 'name')).toHaveValue('Alan Turing')
  await referenceHold(page, t.field(page, 'name'), 'Alan Turing')
})

test('J17: Incoming references from the document menu, any time: opens the referring doc, follows live', async ({page}, info) => {
  const t = target(info)
  // post-07 as the seed writes it (createOrReplace): Barkpark then keeps its edge to Alan
  // some seconds after it points away (task-3fd3c0c53d08a6bd), the case that flaked.
  // Reset while Alan's page loads; done before the panel reads his references.
  const reset = t.resetDoc(ID, 'post')
  await page.goto(t.docPath('author', 'author-alan'))
  await t.settle(page)
  await expect(t.field(page, 'name')).toHaveValue('Alan Turing', {timeout: 15_000})
  await reset
  const menu = t.name === 'sanity' ? page.locator('[data-testid="document-pane"] [data-testid="pane-context-menu-button"]').first() : page.getByRole('button', {name: 'Show document actions'})
  await menu.click()
  await page.getByRole('menuitem', {name: 'Incoming references'}).click()
  await expect(page.getByText('Incoming references', {exact: true}).first()).toBeVisible()
  const row = (id: string, title: string) => page.locator(`a[href*="${id}"]`).filter({hasText: title, visible: true}).first()
  await expect(row('post-07', 'Fixture post 07')).toBeVisible({timeout: 15_000})
  await expect(row('post-01', 'Fixture post 01')).toBeVisible()
  await page.screenshot({path: `evidence/J17-${t.name}-incoming.png`})
  // Live, with the panel in view: a post nowhere on screen starts pointing here (its row
  // comes), and post-07 is pointed elsewhere (its row goes).
  post02Moved = true
  await t.patch('post-02', {author: t.ref('author-alan')})
  // Ours: one read after the frame, and Barkpark's edges are right by then (#22591). Local,
  // one token for studio and rig: no budget, only that it comes (sharedLocalToken).
  const live = t.name === 'studio' && sharedLocalToken() ? 15_000 : undefined
  await expect(row('post-02', 'Fixture post 02')).toBeVisible({timeout: live ?? (t.name === 'studio' ? 2_000 : 15_000)})
  await t.patch(ID, {author: t.ref('author-grace')})
  // At once, from the doc the frame brings: not when Barkpark's backlinks catch up.
  await expect(row('post-07', 'Fixture post 07')).toHaveCount(0, {timeout: live ?? 3_000})
  await expect(page.getByText('Incoming references', {exact: true}).first()).toBeVisible() // still the panel, not a strip
  // A row opens the referring doc in the next pane, at the field that refers.
  await row('post-01', 'Fixture post 01').click()
  await expect.poll(() => decodeURIComponent(page.url()), PAGE_POLL).toMatch(/author-alan.*incoming-references.*;post-01.*path=author/)
})

test('J17: a doc that refers only from its body (an internal link) is used in, and listed', async ({page}, info) => {
  const t = target(info)
  // post-11 and post-13 name Ada only in a body paragraph's internal link (Sanity counts
  // the annotation's reference; Barkpark the wikilink since #22593), never in a field.
  // Barkpark indexes a doc's links when the doc is written, against the schema it has then:
  // a lane whose docs predate its schema has none for them. Say so, not a missing row.
  // The seed's 12 (Sanity's count). A lane can also hold docs of a type the seed doesn't
  // know (e2e-local's `article`, which a reset leaves): Delete counts those too, so ours
  // expects what the lane's own index holds (read while Ada's page loads).
  let referring = 12
  const index =
    t.name === 'studio'
      ? fetch(`${bpBase()}/v1/data/backlinks/${bpDataset()}/author-ada`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}}).then(async (res) => ((await res.json()) as {result: {backlinks: {from_doc_id: string}[]}}).result.backlinks.map((b) => b.from_doc_id))
      : null
  await page.goto(t.docPath('author', 'author-ada'))
  await t.settle(page)
  if (index) {
    const from = await index
    expect(from, `${bpDataset()}'s link index is stale (written before its schema): reset the lane with \`node run.mjs reset\``).toEqual(expect.arrayContaining(['post-11', 'post-13']))
    referring = new Set(from).size
  }
  await expect(t.field(page, 'name')).toHaveValue('Ada Lovelace', {timeout: 15_000})
  const menu = t.name === 'sanity' ? page.locator('[data-testid="document-pane"] [data-testid="pane-context-menu-button"]').first() : page.getByRole('button', {name: 'Show document actions'})
  await menu.click()
  await page.getByRole('menuitem', {name: 'Incoming references'}).click()
  const row = (id: string, title: string) => page.locator(`a[href*="${id}"]`).filter({hasText: title, visible: true}).first()
  await expect(row('post-03', 'Fixture post 03')).toBeVisible({timeout: 15_000})
  await expect(row('post-11', 'Fixture post 11')).toBeVisible()
  await expect(row('post-13', 'Fixture post 13')).toBeVisible()
  await page.screenshot({path: `evidence/J17-${t.name}-incoming-body-link.png`})
  // Delete names them too: Ada is used in 12 docs, two of them only through a link.
  await t.docMenu(page).click()
  await page.getByRole('menuitem', {name: 'Delete'}).click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toContainText(`${referring} documents refer to “Ada Lovelace”`, {timeout: 15_000})
  await dialog.getByRole('button', {name: 'Cancel'}).click()
})

test('@local J17: a draft that points away keeps the row while its published version still refers', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the panel reads the docs from the frames')
  await page.goto(t.docPath('author', 'author-alan'))
  await t.settle(page)
  await page.getByRole('button', {name: 'Show document actions'}).click()
  await page.getByRole('menuitem', {name: 'Incoming references'}).click()
  const row = page.locator('a[href*="post-10"]').filter({hasText: 'Fixture post 10', visible: true}).first()
  await expect(row).toBeVisible({timeout: 15_000})
  // Only a draft of post-10 points at Grace; the published post-10 still names Alan.
  await bpMutate([{patch: {id: 'post-10', type: 'post', set: {author: 'author-grace'}}}])
  await page.waitForTimeout(3000)
  await expect(row).toBeVisible()
  await t.resetDoc('post-10', 'post')
})
