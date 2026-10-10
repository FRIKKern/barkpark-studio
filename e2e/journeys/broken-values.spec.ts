import {expect, test} from '@playwright/test'
import {BACKEND_POLL, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// J39, broken values: a draft written by another client with values the schema
// doesn't allow — a number and a boolean stored as strings, a field the schema
// doesn't know, list items without keys, rich text that is a plain string.
// Evidence on both studios (stills to e2e/evidence/); then the fixes on ours.
const ID = 'post-broken'
const BROKEN = {
  title: 'Broken post',
  rating: '4',
  featured: 'yes',
  oldField: 'left over',
  categories: [{_type: 'reference', _ref: 'category-news'}],
  body: 'plain text body',
}
const shot = (name: string, step: string) => `evidence/J39-${name}-${step}.png`
test.setTimeout(60_000)
test.beforeEach(async ({}, info) => target(info).draftOnly(ID, 'post', BROKEN))
test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).deleteDoc(ID, 'post')))

test('@evidence J39: broken values side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.setViewportSize({width: 1440, height: 2400})
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.waitForTimeout(2500)
  await page.screenshot({path: shot(t.name, '1-doc'), fullPage: true})
})

test('@local J39: convert, reset, add keys, remove unknown, fix rich text', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the fixes run on ours; Sanity is the evidence still')
  await t.prepare(context)
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'All fields'}).click()
  const field = (name: string) => page.locator('.field').filter({has: page.locator(`label[for="${name}"]`)})

  await page.getByRole('button', {name: 'Convert to number'}).click()
  await expect.poll(() => t.docValue(ID, 'rating'), BACKEND_POLL).toBe(4)
  await expect(t.field(page, 'rating')).toHaveValue('4')

  await field('featured').getByRole('button', {name: 'Reset value'}).click()
  await expect.poll(() => t.docValue(ID, 'featured'), BACKEND_POLL).toBeUndefined()

  await page.getByRole('button', {name: 'Add missing keys'}).click()
  await expect.poll(async () => ((await t.docValue(ID, 'categories')) as {_key?: string}[])[0]?._key, BACKEND_POLL).toMatch(/\w{12}/)
  await expect(page.getByText('News', {exact: true})).toBeVisible()

  await page.getByRole('button', {name: 'Remove field oldField'}).click()
  await expect.poll(() => t.docValue(ID, 'oldField'), BACKEND_POLL).toBeUndefined()
  await expect(page.getByText('Unknown field found')).toBeHidden()

  await field('body').getByRole('button', {name: 'Reset value'}).click()
  await expect.poll(() => t.docValue(ID, 'body'), BACKEND_POLL).toBeUndefined()
  // Rich text from another client with a block the canvas can't draw (no id).
  await t.patch(ID, {body: {blocks: [{type: 'paragraph', content: [{type: 'text', value: 'Kept text'}]}]}})
  await page.getByRole('button', {name: 'Add missing block ids'}).click()
  await expect.poll(async () => ((await t.docValue(ID, 'body')) as {blocks: {id?: string}[]}).blocks[0]?.id, BACKEND_POLL).toMatch(/\w{12}/)
  await expect(page.getByText('Kept text')).toBeVisible()
})

// A team moving over from Sanity: its data keeps Sanity's shapes (a reference as {_ref},
// a slug as {current}). The editor opens and reads them as their values; it crashed on
// the reference (scout 2026-10-10: every imported post and author).
test('Sanity-shaped values open in the editor: a {_ref} reference, a {current} slug', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the shapes are Sanity\'s own there')
  await t.prepare(context)
  await t.patch(ID, {author: {_type: 'reference', _ref: 'author-ada'}, slug: {_type: 'slug', current: 'broken-post'}})
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'All fields'}).click()
  await expect(page.getByText('Could not render the document editor')).toHaveCount(0)
  await expect(t.field(page, 'slug')).toHaveValue('broken-post')
  await expect(t.refLink(page.locator('body'), 'author')).toContainText('Ada Lovelace')
})

// task-ec9b4c0c78185fa4: a team moving over from Sanity brings asset values Barkpark has
// no media for: the export form ({_sanityAsset}) and Sanity asset ids. The field shows
// them as they are (never an empty picker, which one save would turn into a drop), a
// save elsewhere leaves them byte-identical, and Reset is the one change offered.
const FOREIGN = 'post-foreign-asset'
const SANITY_IMAGE = {_type: 'image', asset: {_type: 'reference', _ref: 'image-0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6-640x400-png'}}
const SANITY_FILE = {_type: 'file', _sanityAsset: 'file@file://./files/0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6.pdf'}
test('unsupported asset values: shown as they are, kept byte-identical by a save elsewhere, Reset clears one', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: Sanity shows its own assets')
  await t.draftOnly(FOREIGN, 'post', {title: 'Foreign assets', mainImage: SANITY_IMAGE, attachment: SANITY_FILE})
  try {
    await t.prepare(context)
    await page.goto(t.docPath('post', FOREIGN))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('tab', {name: 'All fields'}).click()
    // Each field's card names the asset it holds.
    const image = page.getByRole('alert').filter({hasText: SANITY_IMAGE.asset._ref})
    const file = page.getByRole('alert').filter({hasText: SANITY_FILE._sanityAsset})
    for (const card of [image, file]) await expect(card).toContainText('Unsupported asset value')
    // A save elsewhere sends that field only: the raw values stay exactly as stored
    // (as Barkpark stores them: compared to its own copy from before the save).
    const stored = async () => JSON.stringify([await t.docValue(FOREIGN, 'mainImage'), await t.docValue(FOREIGN, 'attachment')])
    const before = await stored()
    expect(JSON.parse(before)).toEqual([SANITY_IMAGE, SANITY_FILE])
    await t.field(page, 'title').fill('Foreign assets, edited')
    await expect.poll(() => t.docValue(FOREIGN, 'title'), BACKEND_POLL).toBe('Foreign assets, edited')
    expect(await stored()).toBe(before)
    // Reset: the file field is empty, the image untouched.
    await file.getByRole('button', {name: 'Reset value'}).click()
    await expect.poll(async () => (await t.docValue(FOREIGN, 'attachment')) ?? null, BACKEND_POLL).toBeNull()
    await expect(file).toHaveCount(0)
    expect(JSON.stringify(await t.docValue(FOREIGN, 'mainImage'))).toBe(JSON.stringify(JSON.parse(before)[0]))
  } finally {
    await closeAndSettle(page)
    await t.deleteDoc(FOREIGN, 'post')
  }
})
