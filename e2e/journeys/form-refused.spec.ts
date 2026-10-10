import {expect, test, type Page} from '@playwright/test'
import {bpMutate, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// The form's twin of collab.spec's D11 (#373): a save Barkpark refuses (403, 500, or a
// 409 that keeps coming) while someone else's write arrives on the live stream. The
// field must keep the editor's value, say "Not saved", and never turn "Saved" over it;
// once Barkpark takes writes again, the value lands. Text, a tag list, an object's field.
const ID = 'post-refused'
const SEED = {title: 'Refused post', excerpt: 'Short excerpt here.', tags: ['one'], seo: {metaTitle: 'Meta here', metaDescription: 'A description.'}}
test.setTimeout(60_000)
test.beforeEach(async ({}, info) => target(info).draftOnly(ID, 'post', SEED))
test.afterEach(async ({page}, info) => (await page.unrouteAll({behavior: 'ignoreErrors'}), await closeAndSettle(page), await target(info).deleteDoc(ID, 'post')))

/**
 * Answer every save with a Barkpark refusal of `status`, in the studio server's own reply:
 * the save goes out naming a type that does not exist (a real 404 comes back, nothing is
 * written), and the reply is relabelled with the status under test.
 */
const refuse = (page: Page, status: number) =>
  page.route('**/_serverFn/**', async (route) => {
    const req = route.request()
    if (!(req.postData() ?? '').includes('mutations')) return route.continue()
    const res = await route.fetch({postData: (req.postData() ?? '').replace('{"t":1,"s":"post"}', '{"t":1,"s":"no-such-type"}')})
    const body = (await res.text()).replace('mutate 404', `mutate ${status}`).replace('not_found', status === 403 ? 'forbidden' : status === 409 ? 'conflict' : 'internal')
    await route.fulfill({response: res, body})
  })

type Case = {name: string; local: (page: Page) => Promise<void>; remote: Record<string, unknown>; shows: (page: Page) => Promise<unknown>; mine: unknown; landed: (doc: Record<string, unknown>) => boolean; clash?: boolean}
const cases: Case[] = [
  {
    name: 'text (theirs merges)',
    local: async (page) => (await target(test.info()).field(page, 'excerpt').click(), await page.keyboard.press('End'), await page.keyboard.type(' mine')),
    remote: {excerpt: `Theirs. ${SEED.excerpt}`},
    shows: (page) => target(test.info()).field(page, 'excerpt').inputValue(),
    mine: /mine$/,
    landed: (d) => String(d.excerpt).includes('mine') && String(d.excerpt).includes('Theirs.'),
  },
  {
    name: 'text (theirs rewrote it)',
    local: async (page) => (await target(test.info()).field(page, 'excerpt').click(), await page.keyboard.press('End'), await page.keyboard.type(' mine')),
    remote: {excerpt: 'Completely rewritten elsewhere.'},
    shows: (page) => target(test.info()).field(page, 'excerpt').inputValue(),
    mine: /mine/,
    landed: (d) => String(d.excerpt).includes('mine'),
  },
  {
    // Mine has nowhere to go in their text: no silent drop (merge3 used to return theirs).
    // Held, said in the footer, theirs untouched on the server, until the editor types on.
    name: 'text (theirs rewrote the words mine was in)',
    local: async (page) => {
      await target(test.info()).field(page, 'excerpt').click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
      await page.keyboard.type('mine ')
    },
    remote: {excerpt: 'Completely rewritten elsewhere.'},
    shows: (page) => target(test.info()).field(page, 'excerpt').inputValue(),
    mine: /^Short mine excerpt/,
    landed: (d) => String(d.excerpt).includes('mine'),
    clash: true,
  },
  {
    name: 'tag list',
    local: async (page) => {
      await page.getByRole('tab', {name: 'Meta'}).click()
      await page.locator('[id="tags"]').click()
      await page.keyboard.type('mine')
      await page.keyboard.press('Enter')
    },
    remote: {tags: ['one', 'theirs']},
    shows: (page) => page.locator('[id="tags"]').locator('..').innerText(),
    mine: /mine/,
    landed: (d) => (d.tags as string[]).includes('mine'),
  },
  {
    name: "an object's field",
    local: async (page) => {
      await page.getByRole('tab', {name: 'Meta'}).click()
      const field = target(test.info()).field(page, 'seo.metaTitle')
      if (!(await field.isVisible())) await page.getByRole('button', {name: 'SEO'}).click()
      await field.click()
      await page.keyboard.press('End')
      await page.keyboard.type(' mine')
    },
    remote: {seo: {metaTitle: SEED.seo.metaTitle, metaDescription: 'Theirs, changed.'}},
    shows: (page) => target(test.info()).field(page, 'seo.metaTitle').inputValue(),
    mine: /mine$/,
    landed: (d) => String((d.seo as {metaTitle?: string}).metaTitle).includes('mine') && (d.seo as {metaDescription?: string}).metaDescription === 'Theirs, changed.',
  },
]

for (const status of [403, 500, 409])
  for (const c of cases)
    test(`@local refused ${status}, a remote write meanwhile: ${c.name} keeps the editor's value`, async ({page}, info) => {
      const t = target(info)
      test.skip(t.name !== 'studio', 'ours: our save loop')
      await t.prepare(page.context())
      await page.goto(t.docPath('post', ID))
      await signInIfAsked(page)
      await t.settle(page)
      await page.getByRole('tab', {name: 'All fields'}).click().catch(() => {})
      await refuse(page, status)
      await c.local(page)
      const footer = page.locator('.doc-footer').first()
      await expect(footer).toContainText(/Not saved|Couldn|error/i, {timeout: 15_000})
      // Someone else saves the doc meanwhile; its frame reaches this page.
      await bpMutate([{patch: {id: ID, type: 'post', set: c.remote}}])
      await page.waitForTimeout(2500)
      expect(await c.shows(page), 'the editor\'s value is still on screen').toMatch(c.mine as RegExp)
      await expect(footer, 'never "Saved" over an unsaved value').not.toContainText(/Saved|Edited just now/)
      // Barkpark takes writes again: the value lands (a refused 403 waits for the next edit).
      await page.unroute('**/_serverFn/**')
      if (c.clash) {
        await expect(footer).toContainText('Someone else rewrote Excerpt meanwhile')
        await page.waitForTimeout(2500) // no retry sends it over theirs
        expect((await bpDoc(ID))?.excerpt, 'theirs stands until the editor types on').toBe(c.remote.excerpt)
      }
      if (status === 403 || c.clash) await c.local(page)
      await expect.poll(async () => c.landed((await bpDoc(ID)) ?? {}), {timeout: 20_000}).toBe(true)
    })

async function bpDoc(id: string): Promise<Record<string, unknown> | null> {
  const base = `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
  const r = await fetch(`${base}/v1/data/doc/${process.env.BARKPARK_DATASET}/post/${id}?perspective=drafts`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  return r.ok ? ((await r.json()) as {result: Record<string, unknown>}).result : null
}

test('@local refused 500, a remote write meanwhile: an image hotspot keeps the editor\'s move, and theirs', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: our save loop')
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Content'}).click()
  const field = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
  await field.scrollIntoViewIfNeeded()
  await field.locator('input[type=file]').first().setInputFiles('../fixtures/assets/fixture-image.png')
  await expect(field.getByRole('img', {name: 'Preview of uploaded image'})).toBeVisible({timeout: 20_000})
  await expect.poll(async () => !!((await bpDoc(ID))?.mainImage as {asset?: unknown})?.asset, {timeout: 15_000}).toBe(true)
  const image = (await bpDoc(ID))!.mainImage as Record<string, unknown>
  await refuse(page, 500)
  await field.getByRole('button', {name: 'Open image edit dialog'}).click()
  const dialog = page.getByRole('dialog', {name: 'Edit hotspot and crop'})
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(800) // the dialog animates in
  // Shrink the hotspot (a full-size one cannot move), as image.spec does.
  const h = (await dialog.locator('[data-handle="hotspotHandle"]').first().boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 - 180, h.y + h.height / 2 - 110, {steps: 6})
  await page.mouse.up()
  await page.keyboard.press('Escape')
  const footer = page.locator('.doc-footer').first()
  await expect(footer).toContainText(/Not saved|Couldn|error/i, {timeout: 15_000})
  // Someone else sets the alt text meanwhile (Barkpark patches top-level fields: the whole image).
  await bpMutate([{patch: {id: ID, type: 'post', set: {mainImage: {...image, alt: 'Theirs alt'}}}}])
  await page.waitForTimeout(2500)
  await expect(footer, 'never "Saved" over an unsaved value').not.toContainText(/Saved|Edited just now/)
  await page.unroute('**/_serverFn/**')
  await expect.poll(async () => ((await bpDoc(ID))?.mainImage as {hotspot?: {width: number}})?.hotspot?.width ?? 1, {timeout: 20_000}).toBeLessThan(0.9)
  const landed = (await bpDoc(ID))!.mainImage as {alt?: string}
  expect(landed.alt, "theirs (the alt) kept beside mine (the hotspot)").toBe('Theirs alt')
})

// The clash card (CI: it guards the silent drop merge3 used to make). Both versions on the
// field, who and when; "Take theirs" drops mine, "Keep mine" saves mine over theirs.
test('a clash shows both versions on the field: Take theirs, then Keep mine', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: our save loop')
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const excerpt = t.field(page, 'excerpt')
  const card = page.getByTestId('field-clash')
  const footer = page.locator('.doc-footer').first()
  const clashOn = async (rewrite: string) => {
    await refuse(page, 500)
    await excerpt.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.type('mine ')
    const mine = await excerpt.inputValue()
    await expect(footer).toContainText(/Not saved|Couldn|error/i, {timeout: 15_000})
    await bpMutate([{patch: {id: ID, type: 'post', set: {excerpt: rewrite}}}])
    await expect(card).toBeVisible({timeout: 10_000})
    await expect(card.locator('[data-version="theirs"]')).toHaveText(rewrite)
    await expect(card.locator('[data-version="mine"]')).toHaveText(mine)
    await expect(footer).toContainText('Someone else rewrote Excerpt meanwhile')
    await page.unroute('**/_serverFn/**')
    return mine
  }
  // Take theirs: mine goes, the field shows theirs, nothing is sent over it.
  await clashOn('Completely rewritten elsewhere.')
  await expect(card.locator('.field-clash-who')).not.toBeEmpty()
  await card.locator('..').screenshot({path: 'evidence/field-clash.png'})
  await card.getByRole('button', {name: 'Take theirs'}).click()
  await expect(card).toHaveCount(0)
  await expect(excerpt).toHaveValue('Completely rewritten elsewhere.')
  await expect(footer).not.toContainText('Not saved')
  await page.waitForTimeout(1500)
  expect((await bpDoc(ID))?.excerpt).toBe('Completely rewritten elsewhere.')
  // Keep mine: mine is saved over theirs.
  const mine = await clashOn('Another rewrite, again.')
  await card.getByRole('button', {name: 'Keep mine'}).click()
  await expect(card).toHaveCount(0)
  await expect.poll(async () => (await bpDoc(ID))?.excerpt, {timeout: 15_000}).toBe(mine)
  await expect(footer).not.toContainText('Not saved')
})
