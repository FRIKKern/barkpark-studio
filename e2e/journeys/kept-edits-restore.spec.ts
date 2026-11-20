import {writeFileSync} from 'node:fs'
import {expect, test, type Route} from '../rig/test'
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
  // The page's saves and console from here, for a failure at Restore (task-a0122b1b04971f52:
  // once in 56 CI runs no save came after Restore, and the failure said nothing more).
  const t0 = Date.now()
  const log: string[] = []
  // CI logs are public: no headers, no answer bodies, and a request body only for a save (a
  // document mutation). Other server calls (sign-in, session, preview tokens) show method and status only.
  const redact = (s: string) => s.replace(/Bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]*|\b(token|secret|password|cookie|session)\b(\W{0,3})\S+/gi, (m, k, sep) => (k ? `${k}${sep}[redacted]` : '[redacted]'))
  const say = (s: string) => log.push(`${Date.now() - t0} ms ${redact(s)}`)
  const body = (r: {postData: () => string | null}) => ((r.postData() ?? '').includes('mutations') ? ` ${(r.postData() ?? '').slice(0, 200)}` : '')
  page.on('request', (r) => void (r.url().includes('/_serverFn/') && say(`-> ${r.method()}${body(r)}`)))
  page.on('response', (r) => void (r.url().includes('/_serverFn/') && say(`<- ${r.status()} ${r.request().method()}`)))
  page.on('requestfailed', (r) => void (r.url().includes('/_serverFn/') && say(`x ${r.failure()?.errorText}`)))
  page.on('console', (m) => say(`console.${m.type()} ${m.text().slice(0, 300)}`))
  const evidence = async (err: unknown) => {
    const footer = await page.locator('.doc-footer').first().textContent().catch(() => null)
    const aria = await page.locator('body').ariaSnapshot().catch((e: Error) => `(no snapshot: ${e.message})`)
    const text = [`held: ${held.length}`, `footer: ${footer}`, ...log, '--- page', aria].join('\n')
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
