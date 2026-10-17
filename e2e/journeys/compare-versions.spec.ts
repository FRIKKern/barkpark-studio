import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// J68, both studios: the document "…" menu. With one version, Compare versions says
// there is nothing to compare. After an edit, Inline changes marks the changed title in
// place (sticky in the URL), and Compare versions shows published beside the draft.
const ID = 'post-09'
const TITLE = 'Fixture post 09'
const EDITED = 'Fixture post 09 compared'

const menu = async (t: Target, page: Page) => {
  await (t.name === 'sanity' ? page.locator('[data-testid="pane-context-menu-button"]').last() : page.getByRole('button', {name: 'Show document actions'})).click()
  return page.getByRole('menu').last()
}

test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  await target(info).restore(ID, {title: TITLE})
})

test('@local J68: Inline changes and Compare versions', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)

  // One version: nothing to compare, and the item can't be picked.
  await expect((await menu(t, page)).getByRole('menuitem', {name: 'Compare versions'})).toBeDisabled()
  await page.keyboard.press('Escape')

  await t.field(page, 'title').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(EDITED)
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toMatchObject({draft: EDITED})

  // Inline changes: on, in the URL, and the title shows what was added.
  await (await menu(t, page)).getByRole('menuitemcheckbox', {name: 'Inline changes'}).or(page.getByRole('menuitem', {name: 'Inline changes'})).click()
  await expect(page).toHaveURL(/displayInlineChanges=true/)
  if (t.name === 'studio') await expect(page.getByTestId('inline-diff').locator('ins')).toHaveText(' compared')
  await page.screenshot({path: `evidence/J68-${t.name}-1-inline.png`})

  // Compare versions: published (read-only) beside the draft; Escape closes it.
  await (await menu(t, page)).getByRole('menuitem', {name: 'Compare versions'}).click()
  await expect(page).toHaveURL(/diffView(\]|%5D)=version/)
  const dialog = page.locator('#diffView, [data-testid="compare-versions"]')
  await expect(dialog).toContainText('Compare versions')
  if (t.name === 'studio') {
    await expect(dialog.locator('[data-side=published] [id="title"]')).toHaveValue(TITLE)
    await expect(dialog.locator('[data-side=draft] [id="title"]')).toHaveValue(EDITED)
  }
  await page.waitForTimeout(t.name === 'sanity' ? 800 : 0) // its dialog animates in
  await page.screenshot({path: `evidence/J68-${t.name}-2-compare.png`})
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page).not.toHaveURL(/diffView/)

  // Off again.
  await (await menu(t, page)).getByRole('menuitemcheckbox', {name: 'Inline changes'}).or(page.getByRole('menuitem', {name: 'Inline changes'})).click()
  await expect(page).not.toHaveURL(/displayInlineChanges=true/)
})
