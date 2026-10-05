import {expect, test} from '@playwright/test'
import {installProbes, timeToReady} from '../rig/feel'
import {target} from '../rig/targets'

// Crown references, same steps on both studios: J08 (pick by search, open in the
// next pane), J22 (create a new doc from the field), J23 (edit the referenced doc;
// parents follow, live, in a second browser). Budgets apply to ours.
const ID = 'post-07' // author: Alan Turing

test.beforeEach(async ({context}, info) => {
  await Promise.all([target(info).prepare(context), installProbes(context)])
})
const created: string[] = []
test.afterEach(async ({}, info) => {
  const t = target(info)
  await t.restore(ID, {author: t.ref('author-alan')})
  for (const id of created.splice(0)) await t.deleteDoc(id, 'author')
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

test('J22: create a new author from the reference field, edit it in the next pane', async ({page}, info) => {
  const t = target(info)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const pane = t.pane(page, 2)
  await t.refMenu(pane, 'author').click()
  await page.getByRole('menuitem', {name: 'Replace'}).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Barbara Liskov')

  const opened = await timeToReady(
    page,
    pane.getByRole('button', {name: /^Create$/}).last(),
    `() => !!document.querySelector('[data-pane-index="3"] [id="name"]')`,
    null,
  )
  const id = decodeURIComponent(page.url()).match(/;([0-9a-f-]{36}),[^;]*parentRefPath=author/)?.[1]
  expect(id, 'new doc id in the URL').toBeTruthy()
  created.push(id!)
  if (t.name === 'studio') expect(opened.ms, 'F2 new doc pane').toBeLessThan(100)

  // Name it in the new pane; the parent's reference follows.
  const name = t.field(page, 'name')
  await name.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Barbara Liskov')
  await expect(t.refLink(pane, 'author')).toContainText('Barbara Liskov', {timeout: 10_000})
})

test('J23: edit the referenced doc in its pane; parents follow here and in a 2nd browser', async ({browser}, info) => {
  const t = target(info)
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto('/structure/post;post-08;author-grace,type=author,parentRefPath=author'), b.goto(t.docPath('post', 'post-08'))])
    await Promise.all([t.settle(a), t.settle(b)])
    await expect(t.field(a, 'name')).toHaveValue('Grace Hopper')
    const bRef = t.refLink(t.pane(b, 2), 'author')
    await expect(bRef).toContainText('Grace Hopper')
    // B is typing in its own title, caret mid-word: a remote change must not move it (F6).
    await t.field(b, 'title').click()
    await t.field(b, 'title').evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4))

    await t.field(a, 'name').click()
    await a.keyboard.press('End')
    await a.keyboard.type(' X')
    const sent = Date.now()
    const seen = bRef.evaluate(async (el) => {
      while (!el.textContent?.includes('Grace Hopper X')) await new Promise(requestAnimationFrame)
      return performance.timeOrigin + performance.now()
    })
    await expect(t.refLink(t.pane(a, 2), 'author')).toContainText('Grace Hopper X')
    const ms = (await seen) - sent

    const focus = await b.evaluate(() => ({id: document.activeElement?.id, caret: (document.activeElement as HTMLInputElement)?.selectionStart}))
    expect(focus, 'F6: focus and caret stay put in B').toEqual({id: 'title', caret: 4})
    if (t.name === 'studio') expect(ms, 'F4 edit seen in 2nd browser').toBeLessThan(300)
    console.log(`[J23 ${t.name}] A's edit seen in B after ${Math.round(ms)} ms`)
  } finally {
    await t.restore('author-grace', {name: 'Grace Hopper'}, 'author')
    await Promise.all([ctxA.close(), ctxB.close()])
  }
})
