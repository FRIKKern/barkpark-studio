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
