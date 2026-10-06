import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// D06 (Freeform side track, ours only): note-01's last paragraph holds a wikilink to
// note-02 and a link to example.com. Hovering the wikilink shows note-02's title and
// excerpt; its Open puts note-02 in the next pane (the URL says so, back works). The
// plain link's Open goes to a new tab. Stills in e2e/evidence/D06-*.
test('@local D06: a wikilink opens its doc in the next pane; hover shows a preview', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  await page.goto(t.docPath('note', 'note-01'))
  await t.settle(page)
  const canvas = page.locator('[data-pane="doc:note-01"] bp-paper-canvas')

  // A plain link opens a new tab.
  await canvas.getByText('an outside page').hover()
  const open = page.locator('.bp-link-preview__open').filter({visible: true})
  await expect(open).toBeVisible()
  const [tab] = await Promise.all([context.waitForEvent('page'), open.click()])
  await expect.poll(() => tab.url()).toContain('example.com')
  await tab.close()
  await page.bringToFront()
  // The card goes when the pointer leaves for a while.
  await page.mouse.move(5, 5)
  await expect(page.locator('.bp-link-preview__title').filter({visible: true})).toHaveCount(0, {timeout: 5000})
  await page.waitForTimeout(1000) // the canvas's hover intent: a card right after another doesn't open

  // A wikilink.
  await canvas.getByText('the second note').hover()
  await expect(page.locator('.bp-link-preview__title').filter({visible: true})).toHaveText('Fixture note 02')
  await expect(page.locator('.bp-link-preview__excerpt').filter({visible: true})).toHaveText('Second note.')
  await page.screenshot({path: 'evidence/D06-1-hover-studio.png'})
  await page.locator('.bp-link-preview__open').filter({visible: true}).click()
  await expect(page).toHaveURL(/\/structure\/note;note-01;note-02$/)
  await expect(page.locator('[data-pane="doc:note-02"] bp-paper-canvas')).toContainText('Second note.', {timeout: 15_000})
  await page.screenshot({path: 'evidence/D06-2-opened-studio.png'})
  await page.goBack()
  await expect(page).toHaveURL(/\/structure\/note;note-01$/)

})
