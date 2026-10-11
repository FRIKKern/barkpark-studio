import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// J15 evidence, both studios: change two fields; the change bar beside a field
// opens Review changes (what changed since publish, word diff, who); revert one
// field, then the rest. Stills + clips go to e2e/evidence/. Not a CI gate.
const ID = 'post-24'
const TITLE = 'Fixture post 24'
const EXCERPT = 'Short excerpt for post 24.'
const shot = (name: string, step: string) => `evidence/J15-${name}-${step}.png`
test.use({video: 'on'})

const panel = (page: Page) => page.getByRole('tabpanel').filter({hasText: /Revert all|There are no changes/}).last()
async function revert(t: Target, page: Page, field: 'Title' | 'all') {
  const p = panel(page)
  if (t.name === 'studio') await p.getByRole('button', {name: field === 'all' ? 'Revert all' : `Revert changes to ${field}`}).click()
  else if (field === 'all') await p.getByRole('button', {name: 'Revert all'}).click()
  // Sanity: the icon button after the field's diff; From/To are the first two buttons.
  else await p.locator('button').nth(2).click()
  // Both ask, with Sanity's words: one field "…revert the change?" → Revert change;
  // all "…revert all 2 changes?" → Revert all.
  await expect(page.getByText(field === 'all' ? 'Are you sure you want to revert all 2 changes?' : 'Are you sure you want to revert the change?')).toBeVisible()
  await page.waitForTimeout(t.name === 'sanity' ? 600 : 0) // its popover animates in
  await page.screenshot({path: shot(t.name, `confirm-${field}`)})
  await page.getByRole('button', {name: field === 'all' ? 'Revert all' : 'Revert change', exact: true}).filter({visible: true}).last().click()
}

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  const t = target(info)
  await t.restore(ID, {title: TITLE, excerpt: EXCERPT, slug: t.name === 'sanity' ? {_type: 'slug', current: 'fixture-post-24'} : 'fixture-post-24'})
})

test('@evidence J15: change bars, review changes, revert one field and all', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)

  // Three fields: after one is reverted two remain, and Revert all is offered (both studios show it only for more than one change).
  for (const [field, text] of [['title', 'Post 24 reviewed'], ['slug', 'post-24-reviewed'], ['excerpt', 'Changed for review.']] as const) {
    await t.field(page, field).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(text)
  }
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toMatchObject({draft: 'Post 24 reviewed'})

  // The change bar beside Title opens Review changes.
  const bar = t.name === 'sanity' ? page.getByRole('button', {name: 'Review changes'}).first() : page.locator('.field').filter({has: page.locator('[id="title"]')}).locator('.change-bar')
  await expect(bar).toBeVisible({timeout: 10_000})
  await page.waitForTimeout(t.name === 'sanity' ? 1500 : 300) // let the draft's edits land in each history
  await bar.click()
  await expect(panel(page)).toContainText('Post 24 reviewed', {timeout: 15_000})
  await expect(panel(page)).toContainText('Changed for review.')
  // The range starts at the last publish, named as Sanity names it ("Published: …").
  await expect(panel(page)).toContainText('Published:', {timeout: 15_000})
  await page.screenshot({path: shot(t.name, '1-review')})

  // Revert one field: Title goes back, Excerpt stays changed.
  await revert(t, page, 'Title')
  await expect(t.field(page, 'title')).toHaveValue(TITLE, {timeout: 10_000})
  await expect(t.field(page, 'excerpt')).toHaveValue('Changed for review.')
  await page.screenshot({path: shot(t.name, '2-one-reverted')})

  // Revert all.
  await revert(t, page, 'all')
  await expect(t.field(page, 'excerpt')).toHaveValue(EXCERPT, {timeout: 10_000})
  await expect(t.field(page, 'slug')).toHaveValue('fixture-post-24')
  await page.screenshot({path: shot(t.name, '3-all-reverted')})
})

// Editor's day 3: right after a publish there is no draft, and Review changes shows what
// that publish changed (From the publish before it, To this one), as Sanity's does, and
// follows the doc while it is open. The field's "…" shows while the field has focus.
test('@local J15: after a publish, Review changes shows what it changed; field actions on focus', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await t.field(page, 'title').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await page.keyboard.type(' (day three)')
  if (t.name === 'studio') {
    const actions = page.getByRole('button', {name: 'Field actions'}).first()
    expect(await actions.evaluate((el) => Number(getComputedStyle(el.closest('.field-actions')!).opacity))).toBe(1)
  }
  await page.waitForTimeout(t.name === 'sanity' ? 1500 : 500)
  await page.getByRole('button', {name: /^Publish$/}).last().click()
  await expect.poll(() => t.publishedTitle(ID), {timeout: 20_000}).toBe(`${TITLE} (day three)`)
  const menu = t.name === 'sanity' ? page.locator('[data-testid="document-pane"] [data-testid="pane-context-menu-button"]').first() : page.getByRole('button', {name: 'Show document actions'})
  await menu.click()
  await page.getByRole('menuitem', {name: 'History'}).click()
  await page.getByRole('tab', {name: 'Review changes'}).click()
  const review = page.getByRole('tabpanel').filter({hasText: 'Title'}).last()
  await expect(review).toContainText('(day three)', {timeout: 15_000})
  await expect(review).not.toContainText('There are no changes')
})
