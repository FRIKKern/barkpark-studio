import {writeFileSync} from 'node:fs'
import {expect, test, type Locator, type Request, type Route} from '../rig/test'
import {saveReport, type Exchange} from '../rig/save-report'
import {bpMutate, bpRemove, signInIfAsked, target, closeAndSettle, savesLanded} from '../rig/targets'

// J32 widen (task-6612fd882f8b8b63): someone deletes the doc while you type. The save
// that was on its way meets the delete (404); every keystroke is kept, the deleted
// banner says so, and Restore brings the doc back with them on top. Ours only: Sanity
// loses them. Here: Restore against a newer version (the rest of J32's widen:
// kept-edits-deleted.spec, kept-edits-deleted-body.spec).
const ID = 'author-kept-at-delete'
test.setTimeout(60_000)

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  // Confirmed gone (bpRemove): a swallowed delete left drafts that other journeys' lists then
  // counted (task-207df0ed3ed446bf: panes J01 counted one post too many).
  if (target(info).name === 'studio') await bpRemove(ID, 'author')
})

// The CI flake behind this (#446's first run, ci-5: "Kept Author", not "Kept Author typed"):
// after Restore, the kept edits were sent again made against the edited value itself, not
// the restored one (their base came from the screen, which already showed them). A change
// from Barkpark meanwhile then read as "the editor changed nothing here" and took theirs: the
// typing was lost. Here the re-sent save meets a newer rev (412) on purpose: the newer version
// changes the start of the same field. Since #765 the save is fenced on the fields it sets
// (Barkpark compares their values at its rev with now), so a newer version of another field
// lets it through, and the 412 this test was made for never came (task-96fbb6f55ee1dc0c).
test('kept edits put back by Restore survive a newer version meanwhile', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only')
  // The author is made while the browser gets ready (as refs.spec, #935).
  await Promise.all([t.prepare(page.context()), bpMutate([{createOrReplace: {_id: ID, _type: 'author', title: 'Kept Author', name: 'Kept Author'}}, {publish: {id: ID, type: 'author'}}])])
  await page.goto(t.docPath('author', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(t.field(page, 'name')).toHaveValue('Kept Author', {timeout: 15_000})
  // When no save comes after Restore (task-a0122b1b04971f52: once in 56 CI runs, and the failure
  // said nothing more), the test leaves the page's requests and the form: rig/save-report.ts,
  // an allow list for a public log (no headers, no answer bodies, no console).
  const t0 = Date.now()
  const exchanges: Exchange[] = []
  const studio = (r: Request) => r.url().includes('/_serverFn/')
  page.on('request', (r) => void (studio(r) && exchanges.push({at: Date.now() - t0, method: r.method(), url: r.url(), postData: r.postData()})))
  const answered = (r: Request, status: Exchange['status']) => {
    const x = exchanges.findLast((e) => e.url === r.url() && e.method === r.method() && e.status === undefined)
    if (x) x.status = status
  }
  page.on('response', (res) => void (studio(res.request()) && answered(res.request(), res.status())))
  page.on('requestfailed', (r) => void (studio(r) && answered(r, 'failed')))
  const evidence = async (err: unknown) => {
    const read = (l: Locator) => l.textContent({timeout: 1_000}).catch(() => null)
    const text = saveReport({
      exchanges,
      console: [],
      consolePrefixes: [],
      docId: ID,
      values: ['Kept Author typed', 'The Kept Author typed'],
      form: {held: String(held.length), name: await t.field(page, 'name').inputValue({timeout: 1_000}).catch(() => null), footer: await read(page.locator('.doc-footer').first()), banner: await read(page.getByRole('alert').filter({hasText: 'This document has been deleted.'}))},
    })
    const file = info.outputPath('restore-evidence.txt')
    writeFileSync(file, text)
    await info.attach('restore-evidence', {path: file, contentType: 'text/plain'})
    console.log(`kept-edits-restore evidence:\n${text}`)
    throw err
  }
  const held: Route[] = []
  const hold = (route: Route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? void held.push(route) : route.continue())
  await page.route('**/_serverFn/**', hold)
  await t.field(page, 'name').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' typed')
  await expect.poll(() => held.length, {intervals: [50]}).toBeGreaterThan(0)
  await bpMutate([{delete: {id: ID, type: 'author', force: true}}])
  for (const r of held.splice(0)) await r.continue()
  const banner = page.getByRole('alert').filter({hasText: 'This document has been deleted.'})
  await expect(banner).toContainText('Your unsaved edits from', {timeout: 15_000})
  // Restore; the kept edits' save is held while Barkpark gets a newer version of the name.
  await banner.getByRole('button', {name: 'Restore most recent revision'}).click()
  await expect.poll(() => held.length, {intervals: [50], timeout: 15_000}).toBeGreaterThan(0).catch(evidence)
  // The restore has landed on Barkpark (the kept edits' save is still held).
  await expect.poll(() => t.docValue(ID, 'name', 'author'), {timeout: 15_000}).toBe('Kept Author')
  // Landed (bpMutate has its answer): the held save meets the 412 whether its frame came yet or not.
  await bpMutate([{patch: {id: ID, type: 'author', set: {name: 'The Kept Author'}}}])
  for (const r of held.splice(0)) await r.continue()
  await page.unrouteAll({behavior: 'wait'})
  await savesLanded(page)
  // Both: theirs at the start, the typing at the end.
  await expect.poll(() => t.docValue(ID, 'name', 'author'), {timeout: 15_000}).toBe('The Kept Author typed')
  await expect(t.field(page, 'name')).toHaveValue('The Kept Author typed')
})
