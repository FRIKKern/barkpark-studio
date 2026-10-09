import {expect, test, type BrowserContext, type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// B11 widen (task-89fecb4915b2f30d): form edits Barkpark never acknowledged survive the
// tab dying. Saves are cut off (every mutate fails as a network error; a crash sends no
// unload beacon, so there is none), the excerpt is typed into, the tab is closed without
// asking; a new tab on the doc then sends them again (rev unchanged), or, when someone saved meanwhile, offers them
// (Restore merges the text). Ours only: Sanity keeps nothing in the browser. The
// replay and Discard run @local (CI's 60 s budget); the rules are unit-tested too.
const ID = 'post-29'
const EXCERPT = 'Short excerpt for post 29.'
const TITLE = 'Fixture post 29'
test.setTimeout(90_000)

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio') await target(info).restore(ID, {excerpt: EXCERPT, title: TITLE})
})

async function typeThenCrash(context: BrowserContext, t: Target, text: string) {
  const page = await context.newPage()
  await page.addInitScript(() => (navigator.sendBeacon = () => true))
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.route('**/_serverFn/**', (route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? route.abort('failed') : route.continue()))
  await t.field(page, 'excerpt').click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
  await expect(page.locator('.doc-footer').first()).toContainText(/Offline|not saving/i)
  await page.waitForTimeout(500) // the browser store is written a moment after the last keystroke
  await page.close({runBeforeUnload: false})
}

async function reopen(context: BrowserContext, t: Target): Promise<Page> {
  const page = await context.newPage()
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  return page
}

test('kept form edits over a newer save are offered: Restore merges', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity keeps nothing in the browser')
  await t.prepare(context)
  await typeThenCrash(context, t, ' mine')
  await t.patch(ID, {excerpt: `Theirs. ${EXCERPT}`}, 'post')
  const page = await reopen(context, t)
  const card = page.getByTestId('kept-edits')
  await expect(card).toContainText('Unsaved changes from')
  await page.screenshot({path: 'evidence/B11-kept-edits-offer.png'})
  await card.getByRole('button', {name: 'Restore'}).click()
  await expect(card).toBeHidden()
  await expect.poll(() => t.docValue(ID, 'excerpt'), {timeout: 15_000}).toBe(`Theirs. ${EXCERPT} mine`)
})

test('@local kept form edits are sent again after a crash; Discard sticks', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity keeps nothing in the browser')
  await t.prepare(context)
  await typeThenCrash(context, t, ' kept')
  expect(await t.docValue(ID, 'excerpt')).toBe(EXCERPT)
  const page = await reopen(context, t)
  await expect(page.getByText(/Unsaved changes from .* were put back/)).toBeVisible()
  await expect.poll(() => t.docValue(ID, 'excerpt'), {timeout: 15_000}).toBe(`${EXCERPT} kept`)
  await page.close()
  // Discard leaves the server copy alone and the offer does not come back.
  await typeThenCrash(context, t, ' gone')
  await t.patch(ID, {excerpt: EXCERPT}, 'post')
  const again = await reopen(context, t)
  await again.getByTestId('kept-edits').getByRole('button', {name: 'Discard'}).click()
  await again.reload()
  await t.settle(again)
  await expect(again.getByTestId('kept-edits')).toHaveCount(0)
  expect(await t.docValue(ID, 'excerpt')).toBe(EXCERPT)
})

test('@local two tabs, same editor: one dies mid-save while the other saves; its edits are still offered', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity keeps nothing in the browser')
  await t.prepare(context)
  // Tab B is open on the doc too, and its saves go through.
  const b = await reopen(context, t)
  await signInIfAsked(b)
  // Tab A types into the excerpt; its saves never land, then it dies.
  const a = await context.newPage()
  await a.addInitScript(() => (navigator.sendBeacon = () => true))
  await a.goto(t.docPath('post', ID))
  await t.settle(a)
  await a.route('**/_serverFn/**', (route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('mutations') ? route.abort('failed') : route.continue()))
  await t.field(a, 'excerpt').click()
  await a.keyboard.press('End')
  await a.keyboard.type(' fromA')
  await expect(a.locator('.doc-footer').first()).toContainText(/Offline|not saving/i)
  await a.waitForTimeout(500)
  // B edits the title and saves while A is still stuck.
  await t.field(b, 'title').click()
  await b.keyboard.press('End')
  await b.keyboard.type(' fromB')
  await expect.poll(() => t.docValue(ID, 'title'), {timeout: 15_000}).toBe(`${TITLE} fromB`)
  await b.waitForTimeout(500)
  await a.close({runBeforeUnload: false})
  await closeAndSettle(b)
  // Reopened: A's excerpt is offered (B saved since), and Restore keeps B's title.
  const page = await reopen(context, t)
  const card = page.getByTestId('kept-edits')
  await expect(card).toContainText('Unsaved changes from', {timeout: 10_000})
  await card.getByRole('button', {name: 'Restore'}).click()
  await expect.poll(() => t.docValue(ID, 'excerpt'), {timeout: 15_000}).toBe(`${EXCERPT} fromA`)
  expect(await t.docValue(ID, 'title')).toBe(`${TITLE} fromB`)
})

test('@local a kept edit on a field the schema then drops or retypes is neither sent blind nor lost silently', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours only: Sanity keeps nothing in the browser')
  const admin = process.env.BARKPARK_ADMIN_TOKEN
  test.skip(!admin, 'schema writes need the admin token (BARKPARK_ADMIN_TOKEN)')
  const post = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-schema/post.json', import.meta.url), 'utf8'))
  const base = `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
  const putSchema = async (schema: unknown) => {
    const r = await fetch(`${base}/v1/schemas/${process.env.BARKPARK_DATASET}`, {method: 'POST', headers: {authorization: `Bearer ${admin}`, 'content-type': 'application/json'}, body: JSON.stringify(schema)})
    expect(r.ok, `schema write ${r.status}`).toBe(true)
  }
  await t.prepare(context)
  try {
    for (const change of ['removed', 'retyped'] as const) {
      await typeThenCrash(context, t, ` ${change}`)
      const fields = post.fields
        .filter((f: {name: string}) => change === 'retyped' || f.name !== 'excerpt')
        .map((f: {name: string}) => (f.name === 'excerpt' ? {name: 'excerpt', title: 'Excerpt', type: 'number', group: 'content'} : f))
      await putSchema({...post, fields})
      const page = await reopen(context, t)
      // Never dropped without a word: named (by its label, or its name once the schema has
      // none), with Discard and nothing to restore ...
      await expect(page.getByTestId('kept-edits')).toContainText(/excerpt/i)
      // ... and never sent blind to a field the form no longer shows as it was.
      expect(await t.docValue(ID, 'excerpt'), `${change}: not written behind the editor's back`).toBe(EXCERPT)
      await expect(page.getByTestId('kept-edits').getByRole('button', {name: 'Restore'})).toHaveCount(0)
      await page.getByTestId('kept-edits').getByRole('button', {name: 'Discard'}).click()
      await expect(page.getByTestId('kept-edits')).toBeHidden()
      await page.waitForTimeout(300) // the browser store's delete lands before the page goes
      await page.close()
      await putSchema(post)
      expect(await t.docValue(ID, 'excerpt'), `${change}: still not written`).toBe(EXCERPT)
    }
  } finally {
    await putSchema(post)
  }
})
