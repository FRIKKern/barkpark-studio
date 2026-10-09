import {expect, test} from '@playwright/test'
import {installProbes, timeToReady} from '../rig/feel'
import {target, reveal, closeAndSettle} from '../rig/targets'

// J18, both studios: new post from the list, initial values, slug Generate; and the
// "Post by Alan Turing" template (reference/sanity/sanity.config.ts, app studio.config.tsx)
// in the navbar "+", the list "+" (a menu once a type has templates) and a reference's Create.
let created: string | undefined
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (created) await target(info).deleteDoc(created, 'post')
  created = undefined
})

test('@local J18: new post from the list — initial values, slug generate', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.prepare(page.context()), installProbes(page.context())])
  await page.goto(t.listPath('post'))
  await t.settle(page)
  // F2 is the warm open: run the new-doc path once (an untouched new doc is never
  // written), then open a doc, so the timed open below is not the browser's first.
  await t.newDocButton(t.pane(page, 1)).click()
  await page.getByRole('menuitem', {name: 'Post', exact: true}).click()
  await expect(t.field(page, 'title')).toBeVisible()
  await (await reveal(t.listItem(page, 'post-01'))).click()
  await expect(t.field(page, 'title')).toHaveValue('Fixture post 01')

  await t.newDocButton(t.pane(page, 1)).click()
  const opened = await timeToReady(page, page.getByRole('menuitem', {name: 'Post', exact: true}), `() => !!document.querySelector('[data-pane-index="2"] [id="title"]')`, null)
  created = decodeURIComponent(page.url()).match(/;([0-9a-f-]{36})/)?.[1]
  expect(created, 'new doc id in the URL').toBeTruthy()
  if (t.name === 'studio') expect(opened.ms, 'F2 new doc pane').toBeLessThan(100)

  await t.field(page, 'title').click()
  await page.keyboard.type('My brand new post')
  await expect(page).toHaveTitle(/^My brand new post \| /)
  await page.getByRole('button', {name: 'Generate'}).click()
  await expect(t.field(page, 'slug')).toHaveValue('my-brand-new-post')

  // It exists now, with the type's initial value and what was typed.
  await expect.poll(() => t.docValue(created!, 'slug').then((s) => (typeof s === 'object' && s ? (s as {current: string}).current : s)), {timeout: 10_000}).toBe('my-brand-new-post')
  expect(await t.docValue(created!, 'featured')).toBe(false)
})

test('@local J18: templates — "Post by Alan Turing" in every Create new, starts with its author', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.listPath('post'))
  await t.settle(page)
  // The list "+" is a menu of the type and its template.
  await t.newDocButton(t.pane(page, 1)).click()
  await expect(page.getByRole('menuitem', {name: 'Post', exact: true})).toBeVisible()
  await expect(page.getByRole('menuitem', {name: 'Post by Alan Turing'})).toBeVisible()
  await page.keyboard.press('Escape')
  // The navbar "+" lists it beside the types; picking it starts a post with Alan as author.
  await page.getByRole('button', {name: 'Create new document'}).click()
  const pick = t.name === 'sanity' ? page.getByRole('button', {name: 'Post by Alan Turing'}).or(page.getByRole('menuitem', {name: 'Post by Alan Turing'})) : page.getByRole('option', {name: 'Post by Alan Turing'})
  await pick.first().click()
  await expect(t.field(page, 'title')).toBeVisible()
  await expect(page.locator('[data-testid="document-pane"]').last().getByText('Alan Turing').first()).toBeVisible()
  created = decodeURIComponent(page.url()).match(/;([0-9a-f-]{36})/)?.[1]
  await t.field(page, 'title').click()
  await page.keyboard.type('Templated post')
  await expect.poll(() => t.docValue(created!, 'author').then((a) => (a && typeof a === 'object' ? (a as {_ref: string})._ref : a)), {timeout: 10_000}).toBe('author-alan')
  await page.screenshot({path: `evidence/J18-${t.name}-template.png`})
})

test('@local J18: a parameterised template from a structure item — Posts by author → Alan → "+"', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto('/structure')
  await t.settle(page)
  await page.getByText('Posts by author', {exact: true}).click()
  await page.getByText('Alan Turing', {exact: true}).first().click()
  await expect.poll(() => decodeURIComponent(page.url())).toContain('/structure/posts-by-author;author-alan')
  await expect(page.getByText('Fixture post 07', {exact: true}).first()).toBeVisible()
  await page.getByRole('link', {name: 'Post by author'}).or(page.getByRole('button', {name: 'Post by author'})).first().click()
  await expect(t.field(page, 'title')).toBeVisible()
  await expect(page.locator('[data-testid="document-pane"]').last().getByText('Alan Turing').first()).toBeVisible()
  created = decodeURIComponent(page.url()).match(/;([0-9a-f-]{36})/)?.[1]
  await t.field(page, 'title').click()
  await page.keyboard.type('Post by an author')
  await expect.poll(() => t.docValue(created!, 'author').then((a) => (a && typeof a === 'object' ? (a as {_ref: string})._ref : a)), {timeout: 10_000}).toBe('author-alan')
  await page.screenshot({path: `evidence/J18-${t.name}-param-template.png`})
})
