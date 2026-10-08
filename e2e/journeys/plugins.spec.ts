import {expect, test} from '@playwright/test'
import {closeAndSettle, signInIfAsked, target} from '../rig/targets'

// J65, the plugin surface: the studio config's tool (Stats), custom input (a
// character count under Excerpt), document action (Mark/Unmark featured) and
// badge (Featured), and "Open preview" in the document's "…" menu. Both sides
// configure the same plugins: reference/sanity/plugin.tsx, app/src/studio.config.tsx.
const shot = (name: string, step: string) => `evidence/J65-${name}-${step}.png`
const ID = 'post-25' // featured in the seed; no other spec touches it

// Only ours edits it (the action and a keystroke); the Sanity side is stills.
test.afterEach(async ({page}, info) => {
  if (target(info).name !== 'studio') return
  await closeAndSettle(page)
  await target(info).resetDoc(ID, 'post')
})

test('@evidence J65: tool, input, action, badge, Open preview side by side', async ({page, context}, info) => {
  const t = target(info)
  await t.prepare(context)
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await t.field(page, 'excerpt').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1000)
  await page.screenshot({path: shot(t.name, '1-input-badge')})
  await t.docMenu(page).click()
  await page.waitForTimeout(500)
  await page.screenshot({path: shot(t.name, '2-action')})
  await page.keyboard.press('Escape')
  await page.getByRole('link', {name: 'Stats'}).first().click()
  await page.getByRole('heading', {name: 'Stats'}).waitFor()
  await page.waitForTimeout(1500)
  await page.screenshot({path: shot(t.name, '3-tool')})
})

test('@local J65: the studio config adds a tool, an input, an action, a badge and Open preview', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the evidence stills')
  await t.prepare(context)
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)

  // The custom input renders the default one and counts what it holds.
  const excerpt = t.field(page, 'excerpt')
  const length = (await excerpt.inputValue()).length
  await expect(page.getByText(`${length} characters`)).toBeVisible()
  await excerpt.press('End')
  await excerpt.pressSequentially('!')
  await expect(page.getByText(`${length + 1} characters`)).toBeVisible()

  // The action edits the draft like a field would; the badge follows it.
  const badge = page.locator('.doc-footer').getByText('Featured', {exact: true})
  await expect(badge).toBeVisible()
  await t.docMenu(page).click()
  await page.getByRole('menuitem', {name: 'Unmark featured'}).click()
  await expect(badge).toBeHidden()
  await t.docMenu(page).click()
  await expect(page.getByRole('menuitem', {name: 'Mark featured'})).toBeVisible()
  await page.keyboard.press('Escape')

  // "Open preview": the menu item and Ctrl+Alt+O open the post's page in a new tab.
  await context.route('http://localhost:3536/**', (route) => route.fulfill({body: 'preview'}))
  await page.getByRole('button', {name: 'Show document actions'}).last().click()
  const [byMenu] = await Promise.all([context.waitForEvent('page'), page.getByRole('menuitem', {name: /Open preview/}).click()])
  await expect(byMenu).toHaveURL(/\/posts\/fixture-post-25$/)
  await byMenu.close()
  await excerpt.focus()
  const [byKey] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('Control+Alt+KeyO')])
  await expect(byKey).toHaveURL(/\/posts\/fixture-post-25$/)
  await byKey.close()

  // The tool sits after the built-in ones and counts this dataset's documents.
  const tool = page.getByRole('navigation').getByRole('link', {name: 'Stats'})
  await tool.click()
  await expect(page).toHaveURL(/\/stats$/)
  await expect(tool).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('row', {name: /^post \d+ \d+$/})).toBeVisible()
})
