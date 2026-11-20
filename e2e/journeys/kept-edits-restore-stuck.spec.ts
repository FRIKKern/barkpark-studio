import {expect, test, type Route} from '../rig/test'
import {bpBase, bpDataset, bpMutate, bpRemove, signInIfAsked, target, closeAndSettle, savesLanded} from '../rig/targets'

// task-a0122b1b04971f52 step 1: Restore on a deleted doc with kept edits, when the restore
// call fails and when it never answers. Each case pins what a person gets: the error shows,
// the kept edits are still kept, and pressing Restore again brings the doc back with them.
const ID = 'author-kept-restore-stuck'
test.setTimeout(60_000)

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio') await bpRemove(ID, 'author')
})

for (const mode of ['fails', 'never answers'] as const)
  test(`kept edits survive a restore that ${mode}`, async ({page}, info) => {
    const t = target(info)
    test.skip(t.name !== 'studio', 'ours only')
    await Promise.all([t.prepare(page.context()), bpMutate([{createOrReplace: {_id: ID, _type: 'author', title: 'Kept Author', name: 'Kept Author'}}, {publish: {id: ID, type: 'author'}}])])
    await page.goto(t.docPath('author', ID))
    await signInIfAsked(page)
    await t.settle(page)
    await expect(t.field(page, 'name')).toHaveValue('Kept Author', {timeout: 15_000})
    // The doc is deleted while the typing's save is on its way, so the edits are kept (as kept-edits-restore.spec).
    const held: Route[] = []
    let armed = false
    const stubbed: Route[] = []
    await page.route('**/_serverFn/**', (route) => {
      const r = route.request()
      const body = r.postData() ?? ''
      if (r.method() === 'POST' && body.includes('mutations') && !armed) return void held.push(route)
      // The restore: the first other POST after the click.
      if (armed && r.method() === 'POST' && !body.includes('mutations') && !stubbed.length) {
        stubbed.push(route)
        return mode === 'fails' ? void route.abort('failed') : undefined // never answered
      }
      return void route.continue()
    })
    await t.field(page, 'name').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' typed')
    await expect.poll(() => held.length, {intervals: [50]}).toBeGreaterThan(0)
    await bpMutate([{delete: {id: ID, type: 'author', force: true}}])
    for (const r of held.splice(0)) await r.continue()
    const banner = page.getByRole('alert').filter({hasText: 'This document has been deleted.'})
    await expect(banner).toContainText('Your unsaved edits from', {timeout: 15_000})
    const restoreButton = banner.getByRole('button', {name: /Restore most recent revision|Restoring/})
    armed = true
    await restoreButton.click()
    await expect.poll(() => stubbed.length, {intervals: [50], timeout: 10_000}).toBe(1)
    console.log(`a012 ${mode}: stubbed ${stubbed[0]!.request().url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`)
    // 1. The error is shown.
    await expect.soft(page.getByText('Could not restore the document'), '1. the error is shown').toBeVisible({timeout: 10_000})
    // 2. The kept edits are still kept (the banner says so; nothing reached Barkpark).
    await expect.soft(banner, '2. the kept edits are still kept').toContainText('Your unsaved edits from')
    // 3. Pressing Restore again sends them.
    armed = false
    await page.unroute('**/_serverFn/**')
    const again = await restoreButton.isEnabled()
    expect.soft(again, '3a. Restore can be pressed again').toBe(true)
    console.log(`a012 ${mode}: button "${(await restoreButton.textContent())?.trim()}", enabled ${again}`)
    if (!again) return
    await restoreButton.click()
    await savesLanded(page)
    await expect.soft.poll(() => t.docValue(ID, 'name', 'author'), {message: '3b. the second Restore sends the kept edits', timeout: 15_000}).toBe('Kept Author typed')
  })

// A restore that answers only after newer edits were saved is refused, and the edits stay.
// Needs Barkpark's restore guard (task-a0122b1b04971f52); checked on Barkpark directly.
test('a late restore after newer edits is refused and keeps them', async ({}, info) => {
  test.skip(target(info).name !== 'studio', 'ours only')
  test.skip(!/^(e2e-|ci)/.test(bpDataset()), 'writes: an e2e or ci dataset only')
  const auth = {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}
  const name = async () => {
    const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/author/${ID}?perspective=drafts`, {headers: auth})
    return r.ok ? ((await r.json()) as {result: {name?: string}}).result.name : `(${r.status})`
  }
  await bpMutate([{createOrReplace: {_id: ID, _type: 'author', title: 'Kept Author', name: 'Kept Author'}}, {publish: {id: ID, type: 'author'}}])
  await bpMutate([{delete: {id: ID, type: 'author', force: true}}])
  const history = (await (await fetch(`${bpBase()}/v1/data/history/${bpDataset()}/author/${ID}?limit=10`, {headers: auth})).json()) as {revisions: {id: string; action: string}[]}
  const last = history.revisions.find((r) => r.action !== 'delete')!
  const restore = () => fetch(`${bpBase()}/v1/data/revision/${bpDataset()}/${last.id}/restore?type=author`, {method: 'POST', headers: auth})
  expect((await restore()).status, 'the restore succeeds').toBe(200)
  await bpMutate([{patch: {id: ID, type: 'author', set: {name: 'Kept Author typed'}}}])
  expect(await name(), 'the kept edits are saved').toBe('Kept Author typed')
  const late = await restore()
  const after = await name()
  console.log(`a012 late: answered ${late.status}; name "${after}"`)
  expect.soft(late.status, 'the late restore is refused').not.toBe(200)
  expect.soft(after, 'the kept edits stay').toBe('Kept Author typed')
})
