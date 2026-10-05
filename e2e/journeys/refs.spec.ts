import {expect, test} from '@playwright/test'
import {installProbes, timeToReady} from '../rig/feel'
import {target} from '../rig/targets'

// Crown references, same steps on both studios: J08 (pick by search, open in the
// next pane). Budgets apply to ours.
const ID = 'post-07' // author: Alan Turing

test.beforeEach(async ({context}, info) => {
  await Promise.all([target(info).prepare(context), installProbes(context)])
})
test.afterEach(async ({}, info) => {
  const t = target(info)
  await t.restore(ID, {author: t.ref('author-alan')})
})

test('J08: replace the author by search, open it in the next pane', async ({page}, info) => {
  const t = target(info)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const pane = t.pane(page, 2)
  await t.refMenu(pane, 'author').click()
  await page.getByRole('menuitem', {name: 'Replace'}).click()
  await expect(t.field(page, 'author')).toBeFocused()
  await page.keyboard.type('gra')
  await page.getByRole('option', {name: /Grace Hopper/}).first().click()
  await expect(t.refLink(pane, 'author')).toContainText('Grace Hopper')

  const opened = await timeToReady(page, t.refLink(pane, 'author'), `() => location.pathname.includes('author-grace')`, null)
  await expect(t.field(page, 'name')).toHaveValue('Grace Hopper')
  if (t.name === 'studio') expect(opened.ms, 'F2 open picked ref').toBeLessThan(100)
})

test('J08 F5: the same journey with the keyboard only', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'keyboard budget is ours; Sanity drops focus to <body> after a pick')
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await t.refMenu(t.pane(page, 2), 'author').focus()
  for (const key of ['Enter', 'ArrowDown', 'Enter']) await page.keyboard.press(key) // menu → Replace
  await page.keyboard.type('ada')
  await expect(page.getByRole('option', {name: /Ada Lovelace/})).toBeVisible()
  await page.keyboard.press('Enter') // pick; focus lands on the new preview
  await page.keyboard.press('Enter') // open it
  await expect(t.field(page, 'name')).toHaveValue('Ada Lovelace')
  await expect.poll(() => decodeURIComponent(page.url())).toContain(';author-ada,type=author,parentRefPath=author')
})
