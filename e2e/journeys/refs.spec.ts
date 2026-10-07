import {expect, test} from '@playwright/test'
import {installProbes, networkBudget, timeToReady} from '../rig/feel'
import {target} from '../rig/targets'
import {referenceHold} from '../rig/reference'

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

test('J08: replace the author by search, open it in the next pane; then the same by keyboard (F5)', async ({page}, info) => {
  const t = target(info)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const pane = t.pane(page, 2)
  await referenceHold(page, t.field(page, 'title'), 'Fixture post 07')
  await t.refMenu(pane, 'author').click()
  await referenceHold(page, page.getByRole('menuitem', {name: 'Replace'}))
  await page.getByRole('menuitem', {name: 'Replace'}).click()
  await expect(t.field(page, 'author')).toBeFocused()
  // The reference can retain the old label after Replace; replace the query
  // explicitly rather than appending to "Alan Turing".
  await t.field(page, 'author').fill('gra')
  // Sanity's document-list rows are options too, including posts subtitled
  // "Grace Hopper". Its picker result is a button, ours a scoped option.
  const grace = t.name === 'sanity'
    ? page.getByRole('button', {name: 'Grace Hopper', exact: true})
    : pane.getByRole('option', {name: /Grace Hopper/})
  await referenceHold(page, grace)
  await grace.click()
  await expect(t.refLink(pane, 'author')).toContainText('Grace Hopper')
  const documentPath = () => decodeURIComponent(new URL(page.url()).pathname).split(';').map((part) => part.split(',')[0]).join(';')
  await expect.poll(documentPath).toBe(t.docPath('post', ID))
  await referenceHold(page, t.refLink(pane, 'author'))

  const opened = await timeToReady(page, t.refLink(pane, 'author'), `() => location.pathname.includes('author-grace')`, null)
  await expect(t.field(page, 'name')).toHaveValue('Grace Hopper')
  await expect.poll(documentPath).toBe(`${t.docPath('post', ID)};author-grace`)
  await referenceHold(page, t.field(page, 'name'), 'Grace Hopper')
  if (t.name === 'studio') expect(opened.ms, 'F2 open picked ref').toBeLessThan(100)

  // F5, same pane, keyboard only: close the author pane, then replace again and open.
  test.skip(t.name === 'sanity', 'keyboard budget is ours; Sanity drops focus to <body> after a pick')
  await t.closeButton(t.pane(page, 3)).click()
  await expect(page.locator('[data-pane-index]')).toHaveCount(3)
  await t.refMenu(pane, 'author').focus()
  for (const key of ['Enter', 'ArrowDown', 'Enter']) await page.keyboard.press(key) // menu → Replace
  await expect(page.getByRole('option', {name: /Grace Hopper/})).toBeVisible()
  // A new query must not leave the old author selectable while the response is
  // pending. ArrowDown on the empty result set must still allow the first hit.
  let resume!: () => void
  const pending = new Promise<void>((r) => { resume = r })
  let held = false
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() === 'GET') { held = true; await pending }
    await route.continue()
  })
  try {
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('ada')
    await expect.poll(() => held).toBe(true)
    await expect(page.getByRole('status').filter({hasText: 'Searching…'})).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(0)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(t.field(page, 'author')).toBeFocused()
  } finally {
    resume()
    await page.unrouteAll({behavior: 'wait'})
  }
  await expect(page.getByRole('option', {name: /Ada Lovelace/})).toBeVisible()
  await page.keyboard.press('Enter') // pick; focus lands on the new preview
  await page.keyboard.press('Enter') // open it
  await expect(t.field(page, 'name')).toHaveValue('Ada Lovelace')
  await expect.poll(() => decodeURIComponent(page.url())).toContain(';author-ada,type=author,parentRefPath=author')
  await referenceHold(page, t.field(page, 'name'), 'Ada Lovelace')
})

test('J22: create a new author from the reference field, edit it in the next pane', async ({page}, info) => {
  const t = target(info)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const pane = t.pane(page, 2)
  await referenceHold(page, t.field(page, 'title'), 'Fixture post 07')
  await t.refMenu(pane, 'author').click()
  await referenceHold(page, page.getByRole('menuitem', {name: 'Replace'}))
  await page.getByRole('menuitem', {name: 'Replace'}).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Barbara Liskov')
  await referenceHold(page, pane.getByRole('button', {name: /^Create$/}).last())

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
  await referenceHold(page, name)
  await name.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Barbara Liskov')
  await expect(t.refLink(pane, 'author')).toContainText('Barbara Liskov', {timeout: 10_000})
  await referenceHold(page, name, 'Barbara Liskov')
})

test('J23: edit the referenced doc in its pane; parents follow here and in a 2nd browser', async ({browser}, info) => {
  const t = target(info)
  const recording = !!process.env.RECORDING_RUN_ID
  const options = recording ? {recordVideo: {dir: info.outputPath('videos'), size: {width: 1440, height: 900}}, viewport: {width: 1440, height: 900}} : {}
  const [ctxA, ctxB] = await Promise.all([browser.newContext(options), browser.newContext(options)])
  await Promise.all([t.prepare(ctxA), t.prepare(ctxB)])
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()])
  try {
    await Promise.all([a.goto('/structure/post;post-08;author-grace,type=author,parentRefPath=author'), b.goto(t.docPath('post', 'post-08'))])
    await Promise.all([t.settle(a), t.settle(b)])
    await expect(t.field(a, 'name')).toHaveValue('Grace Hopper')
    const bRef = t.refLink(t.pane(b, 2), 'author')
    await expect(bRef).toContainText('Grace Hopper')
    await Promise.all([referenceHold(a, t.field(a, 'name'), 'Grace Hopper'), referenceHold(b, bRef)])
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
    // QUALITY F4 is p95 < 300 ms. Writes are coalesced to one per 750 ms while the
    // shared token's write budget is 60/min (task-2c31de0cf6597d32), so the last
    // keystroke of a burst can wait one gap. Back to 300 when that lands.
    if (t.name === 'studio') expect(ms, 'F4 edit seen in 2nd browser').toBeLessThan(networkBudget(1000))
    console.log(`[J23 ${t.name}] A's edit seen in B after ${Math.round(ms)} ms`)
    await Promise.all([referenceHold(a, t.field(a, 'name'), 'Grace Hopper X'), referenceHold(b, bRef)])
  } finally {
    try {
      await t.restore('author-grace', {name: 'Grace Hopper'}, 'author')
    } finally {
      await Promise.all([ctxA.close(), ctxB.close()])
      if (recording) {
        for (const [name, page] of [['editor', a], ['observer', b]] as const) {
          await info.attach(`J23-${name}`, {path: await page.video()!.path(), contentType: 'video/webm'})
        }
      }
    }
  }
})

test('J17: deleting a referenced author shows where it is used', async ({page}, info) => {
  const t = target(info)
  await page.goto(t.docPath('author', 'author-alan'))
  await t.settle(page)
  await referenceHold(page, t.field(page, 'name'), 'Alan Turing')
  await t.docMenu(page).click()
  await referenceHold(page, page.getByRole('menuitem', {name: 'Delete'}))
  await page.getByRole('menuitem', {name: 'Delete'}).click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toContainText('10 documents refer to “Alan Turing”')
  await expect(dialog).toContainText('Fixture post 01')
  await referenceHold(page, dialog)
  await dialog.getByRole('button', {name: 'Cancel'}).click()
  await expect(dialog).toBeHidden()
  await expect(t.field(page, 'name')).toHaveValue('Alan Turing')
  await referenceHold(page, t.field(page, 'name'), 'Alan Turing')
})
