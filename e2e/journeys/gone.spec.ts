import {expect, test, type Page} from '@playwright/test'
import {sanityMutate, signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// J32 evidence, both studios: someone else (an API write, as another editor would)
// (1) deletes the doc you have open → "This document has been deleted." + Restore
// most recent revision; (2) points the parent's reference elsewhere while you have
// the referenced doc open next to it → "This reference has changed since you opened
// it." + Reload reference; (3) removes it → "…has been removed…" + Close reference.
// Edits by others to the open doc arrive live (J05) and need no banner. What each
// side shows goes to the annotations; stills + clips in e2e/evidence/. Not a CI gate.
const AUTHOR = 'author-j32'
const POST = 'post-13'
const shot = (name: string, step: string) => `evidence/J32-${name}-${step}.png`
test.use({video: 'on'})
test.setTimeout(150_000)

const sanity = (mutations: unknown[]) => sanityMutate(mutations).then((r) => r.json())
const bp = (mutations: unknown[]) =>
  fetch(`${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/data/mutate/${process.env.BARKPARK_DATASET}`, {method: 'POST', headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`, 'content-type': 'application/json'}, body: JSON.stringify({mutations})}).then((r) => r.json())

const createAuthor = (t: Target) =>
  t.name === 'sanity' ? sanity([{createOrReplace: {_id: AUTHOR, _type: 'author', name: 'J32 Author'}}]) : bp([{createOrReplace: {_id: AUTHOR, _type: 'author', title: 'J32 Author', name: 'J32 Author'}}, {publish: {id: AUTHOR, type: 'author'}}])
const deleteAuthor = (t: Target) => (t.name === 'sanity' ? sanity([{delete: {id: `drafts.${AUTHOR}`}}, {delete: {id: AUTHOR}}]) : bp([{delete: {id: AUTHOR, type: 'author'}}]))
const banner = (page: Page, text: RegExp) => page.getByText(text).first()

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  const t = target(info)
  await t.restore(POST, {author: t.ref('author-alan')})
  await deleteAuthor(t)
})

test('@evidence J32: deleted doc, reference changed, reference removed', async ({page}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => info.annotations.push({type: what, description: JSON.stringify(v)})
  await t.prepare(page.context())

  // 1. The open doc is deleted by someone else.
  await createAuthor(t)
  await page.goto(t.docPath('author', AUTHOR))
  await signInIfAsked(page)
  await t.settle(page)
  await expect(t.field(page, 'name')).toHaveValue('J32 Author', {timeout: 15_000})
  await deleteAuthor(t)
  const deleted = banner(page, /This document has been deleted/)
  const sawDeleted = await deleted.isVisible({timeout: 10_000}).catch(() => false) || (await deleted.waitFor({timeout: 10_000}).then(() => true, () => false))
  note('deleted banner', sawDeleted)
  await page.screenshot({path: shot(t.name, '1-deleted')})
  if (t.name === 'studio') {
    expect(sawDeleted).toBe(true)
    await page.getByRole('button', {name: 'Restore most recent revision'}).click()
    await expect(t.field(page, 'name')).toHaveValue('J32 Author', {timeout: 15_000})
    await expect.poll(() => t.docValue(AUTHOR, 'name', 'author'), {timeout: 10_000}).toBe('J32 Author')
    await page.screenshot({path: shot(t.name, '2-restored')})
  }

  // 2. A post, its author open in the next pane; someone points the post elsewhere.
  await page.goto(t.name === 'sanity' ? `/structure/post;${POST};author-alan%2Cparent%3D${POST}%2CparentRefPath%3Dauthor` : `/structure/post;${POST};author-alan,type=author,parentRefPath=author`)
  await signInIfAsked(page)
  await t.settle(page)
  await expect(page.getByText('Alan Turing').first()).toBeVisible({timeout: 15_000})
  await t.patch(POST, {author: t.ref('author-grace')})
  const changed = banner(page, /This reference has changed since you opened it/)
  const sawChanged = await changed.waitFor({timeout: 15_000}).then(() => true, () => false)
  note('reference changed banner', sawChanged)
  await page.screenshot({path: shot(t.name, '3-ref-changed')})
  if (sawChanged) {
    await page.getByRole('button', {name: 'Reload reference'}).click()
    await expect.poll(() => decodeURIComponent(page.url())).toContain('author-grace')
    note('after reload', decodeURIComponent(new URL(page.url()).pathname))
  }
  if (t.name === 'studio') expect(sawChanged).toBe(true)

  // 3. Someone removes the reference.
  await t.restore(POST, {}, 'post', ['author'])
  const removed = banner(page, /This reference has been removed since you opened it/)
  const sawRemoved = await removed.waitFor({timeout: 15_000}).then(() => true, () => false)
  note('reference removed banner', sawRemoved)
  await page.screenshot({path: shot(t.name, '4-ref-removed')})
  if (sawRemoved) {
    await page.getByRole('button', {name: 'Close reference'}).click({timeout: 5_000}).catch(() => note('close reference', 'no Close reference button'))
    await page.waitForTimeout(1500)
    note('after close', decodeURIComponent(new URL(page.url()).pathname))
    if (t.name === 'studio') expect(decodeURIComponent(page.url())).not.toContain('author-')
  }
  if (t.name === 'studio') expect(sawRemoved).toBe(true)
})
