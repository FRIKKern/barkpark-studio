import {expect, test} from '@playwright/test'
import {installProbes, networkBudget, recordFeel, timeToReady} from '../rig/feel'
import {bpMutate, target, closeAndSettle, reveal} from '../rig/targets'
import {referenceHold} from '../rig/reference'

// Crown references, same steps on both studios: J08 (pick by search, open in the
// next pane), J22 (create a new doc from the field), J23 (edit the referenced doc;
// parents follow, live, in a second browser). Budgets apply to ours.
const ID = 'post-07' // author: Alan Turing

test.beforeEach(async ({context}, info) => {
  await Promise.all([target(info).prepare(context), installProbes(context)])
})
const created: string[] = []
let alanEdited = false
let post02Moved = false
test.afterEach(async ({page}, info) => {
  const t = target(info)
  // A save the page still has on its way (a replaced author, a new author's name) would
  // land after the restore and leave a draft behind for the next run.
  await closeAndSettle(page)
  await t.restore(ID, {author: t.ref('author-alan')})
  if (alanEdited) await t.restore('author-alan', {bio: 'Alan Turing writes fixture posts.'}, 'author')
  if (post02Moved) await t.restore('post-02', {author: t.ref('author-grace')})
  post02Moved = false
  alanEdited = false
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
  if (t.name === 'studio') {
    expect(opened.ms, 'F2 open picked ref').toBeLessThan(100)
    expect(opened.cls, 'F2 no late layout shift').toBe(0)
  }

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

  // A create interrupted by an offline blip must retry as a create, preserve
  // typing in its optimistic pane, and only then set the parent's reference.
  let release: (() => void) | undefined
  let held = false
  if (t.name === 'studio') {
    const pending = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/_serverFn/**', async (route) => {
      if (!held && route.request().method() === 'POST' && route.request().postData()?.includes('"create"')) {
        held = true
        await pending
        await route.abort('failed')
      } else await route.continue()
    })
  }

  try {
    const opened = await timeToReady(
      page,
      pane.getByRole('button', {name: /^Create$/}).last(),
      `() => !!document.querySelector('[data-pane-index="3"] [id="name"]')`,
      null,
    )
    const id = decodeURIComponent(page.url()).match(/;([0-9a-f-]{36}),[^;]*parentRefPath=author/)?.[1]
    expect(id, 'new doc id in the URL').toBeTruthy()
    created.push(id!)
    if (t.name === 'studio') {
      expect(opened.ms, 'F2 new doc pane').toBeLessThan(100)
      expect(opened.cls, 'F2 no late layout shift').toBe(0)
      await expect.poll(() => held).toBe(true)
      await page.context().setOffline(true)
      release!()
      await page.unrouteAll({behavior: 'wait'})
      await expect(t.pane(page, 3)).toContainText('Offline — not saving')
      expect(await t.docValue(ID, 'author'), 'no reference before creation').toEqual(t.ref('author-alan'))
    }

    // Name it in the new pane; the parent's reference follows.
    const name = t.field(page, 'name')
    await referenceHold(page, name)
    await name.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Barbara Liskov II')
    if (t.name === 'studio') await page.context().setOffline(false)
    await expect(t.refLink(pane, 'author')).toContainText('Barbara Liskov II', {timeout: 10_000})
    await expect.poll(() => t.docValue(id!, 'name', 'author').catch(() => undefined)).toBe('Barbara Liskov II')
    await expect.poll(async () => {
      const value = await t.docValue(ID, 'author')
      // Sanity adds weak/strengthen-on-publish metadata for a new draft.
      return typeof value === 'string' ? value : (value as {_ref?: string} | null)?._ref
     }).toBe(id)
    await referenceHold(page, name, 'Barbara Liskov II')
  } finally {
    release?.()
    await page.context().setOffline(false)
    await page.unrouteAll({behavior: 'ignoreErrors'})
  }
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
    const seen = bRef.evaluate(async (el) => {
      while (!el.textContent?.includes('Grace Hopper X')) await new Promise(requestAnimationFrame)
      return performance.timeOrigin + performance.now()
    })
    const sent = Date.now()
    await a.keyboard.type(' X')
    await expect(t.refLink(t.pane(a, 2), 'author')).toContainText('Grace Hopper X')
    const ms = (await seen) - sent
    recordFeel('F4', ms)

    const focus = await b.evaluate(() => ({id: document.activeElement?.id, caret: (document.activeElement as HTMLInputElement)?.selectionStart}))
    expect(focus, 'F6: focus and caret stay put in B').toEqual({id: 'title', caret: 4})
    // QUALITY F4 is p95 < 300 ms. Writes are coalesced to one per 750 ms while the
    // shared token's write budget is 60/min (task-2c31de0cf6597d32), so the last
    // keystroke of a burst can wait one gap. Back to 300 when that lands.
    if (t.name === 'studio') expect(ms, 'F4 edit seen in 2nd browser').toBeLessThan(networkBudget(1000))
    console.log(`[J23 ${t.name}] A's edit seen in B after ${Math.round(ms)} ms`)
    await Promise.all([referenceHold(a, t.field(a, 'name'), 'Grace Hopper X'), referenceHold(b, bRef)])
    // The list's author subtitle must remain live after B closes its post pane;
    // subscribing to post mutations alone leaves an already-loaded author stale.
    // Ours: the write lands after the list rendered on the server but before its
    // stream opens (held), and still reaches it (task-e888fb12ca6ff84c).
    let release = () => {}
    if (t.name === 'studio') {
      const held = new Promise<void>((r) => (release = r))
      await b.route('**/api/listen?**', async (route) => (await held, route.continue()))
    }
    await b.goto(t.listPath('post'))
    const row = await reveal(t.listItem(b, 'post-08'))
    await expect(row).toContainText('Grace Hopper X')
    // A's edit has forked a draft; Sanity's direct helper names versions explicitly.
    await t.patch(t.name === 'sanity' ? 'drafts.author-grace' : 'author-grace', {name: 'Grace Hopper live'}, 'author')
    release()
    await expect(row).toContainText('Grace Hopper live')
    await referenceHold(b, row)
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
  if (t.name === 'studio') {
    await expect(t.field(page, 'name')).toHaveValue('Alan Turing')
    await page.route('**/_serverFn/**', (route) => route.request().method() === 'GET' ? route.abort('failed') : route.continue())
  }
  await t.docMenu(page).click()
  await referenceHold(page, page.getByRole('menuitem', {name: 'Delete'}))
  await page.getByRole('menuitem', {name: 'Delete'}).click()
  const dialog = page.getByRole('dialog').last()
  if (t.name === 'studio') {
    await expect(dialog.getByRole('alert')).toContainText('Could not check where this document is used')
    await expect(dialog.getByRole('button', {name: 'Delete now'})).toBeDisabled()
    await page.unrouteAll({behavior: 'wait'})
    await dialog.getByRole('button', {name: 'Retry', exact: true}).focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused()
  }
  await expect(dialog).toContainText('10 documents refer to “Alan Turing”')
  await expect(dialog).toContainText('Fixture post 01')
  await referenceHold(page, dialog)
  if (t.name === 'studio') {
    // Refuse the write before it reaches the API; a failed delete must keep focus. Reads
    // are slowed, and a live frame (someone saves a referring post) makes the dialog read
    // "used in" again meanwhile: the buttons must hold still through that re-read (it
    // disabled Delete under the caret, and Enter went to Close: CI, 2026-10-09).
    let reading!: () => void
    const reread = new Promise<void>((r) => (reading = r))
    await page.route('**/_serverFn/**', async (route) => {
      if (route.request().method() === 'POST') return route.abort('failed')
      if (!decodeURIComponent(route.request().url()).includes('author-alan')) return route.continue().catch(() => {})
      reading() // the "used in" read for Alan
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue().catch(() => {})
    })
    alanEdited = true
    await t.patch('author-alan', {bio: `Edited meanwhile ${Date.now()}`}, 'author') // someone saves Alan (afterEach puts it back)
    await reread // the dialog is reading "used in" again right now
    const anyway = dialog.getByRole('button', {name: 'Delete anyway'})
    await expect(anyway).toBeEnabled({timeout: 100})
    await anyway.focus()
    await expect(anyway).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('alert')).toContainText('Could not delete')
    await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused()
    await page.unrouteAll({behavior: 'ignoreErrors'})
  }
  await dialog.getByRole('button', {name: 'Cancel'}).click()
  await expect(dialog).toBeHidden()
  await expect(t.field(page, 'name')).toHaveValue('Alan Turing')
  await referenceHold(page, t.field(page, 'name'), 'Alan Turing')
})

test('J17: Incoming references from the document menu, any time: opens the referring doc, follows live', async ({page}, info) => {
  const t = target(info)
  // post-07 as the seed writes it (createOrReplace): Barkpark then keeps its edge to Alan
  // some seconds after it points away (task-3fd3c0c53d08a6bd), the case that flaked.
  await t.resetDoc(ID, 'post')
  await page.goto(t.docPath('author', 'author-alan'))
  await t.settle(page)
  await expect(t.field(page, 'name')).toHaveValue('Alan Turing', {timeout: 15_000})
  const menu = t.name === 'sanity' ? page.locator('[data-testid="document-pane"] [data-testid="pane-context-menu-button"]').first() : page.getByRole('button', {name: 'Show document actions'})
  await menu.click()
  await page.getByRole('menuitem', {name: 'Incoming references'}).click()
  await expect(page.getByText('Incoming references', {exact: true}).first()).toBeVisible()
  const row = (id: string, title: string) => page.locator(`a[href*="${id}"]`).filter({hasText: title, visible: true}).first()
  await expect(row('post-07', 'Fixture post 07')).toBeVisible({timeout: 15_000})
  await expect(row('post-01', 'Fixture post 01')).toBeVisible()
  await page.screenshot({path: `evidence/J17-${t.name}-incoming.png`})
  // Live, with the panel in view: a post nowhere on screen starts pointing here (its row
  // comes), and post-07 is pointed elsewhere (its row goes).
  post02Moved = true
  await t.patch('post-02', {author: t.ref('author-alan')})
  // Ours: one read after the frame, and Barkpark's edges are right by then (#22591).
  await expect(row('post-02', 'Fixture post 02')).toBeVisible({timeout: t.name === 'studio' ? 2_000 : 15_000})
  await t.patch(ID, {author: t.ref('author-grace')})
  // At once, from the doc the frame brings: not when Barkpark's backlinks catch up.
  await expect(row('post-07', 'Fixture post 07')).toHaveCount(0, {timeout: 3_000})
  await expect(page.getByText('Incoming references', {exact: true}).first()).toBeVisible() // still the panel, not a strip
  // A row opens the referring doc in the next pane, at the field that refers.
  await row('post-01', 'Fixture post 01').click()
  await expect.poll(() => decodeURIComponent(page.url())).toMatch(/author-alan.*incoming-references.*;post-01.*path=author/)
})

test('J17: a doc that refers only from its body (an internal link) is used in, and listed', async ({page}, info) => {
  const t = target(info)
  // post-11 and post-13 name Ada only in a body paragraph's internal link (Sanity counts
  // the annotation's reference; Barkpark the wikilink since #22593), never in a field.
  await page.goto(t.docPath('author', 'author-ada'))
  await t.settle(page)
  await expect(t.field(page, 'name')).toHaveValue('Ada Lovelace', {timeout: 15_000})
  const menu = t.name === 'sanity' ? page.locator('[data-testid="document-pane"] [data-testid="pane-context-menu-button"]').first() : page.getByRole('button', {name: 'Show document actions'})
  await menu.click()
  await page.getByRole('menuitem', {name: 'Incoming references'}).click()
  const row = (id: string, title: string) => page.locator(`a[href*="${id}"]`).filter({hasText: title, visible: true}).first()
  await expect(row('post-03', 'Fixture post 03')).toBeVisible({timeout: 15_000})
  await expect(row('post-11', 'Fixture post 11')).toBeVisible()
  await expect(row('post-13', 'Fixture post 13')).toBeVisible()
  await page.screenshot({path: `evidence/J17-${t.name}-incoming-body-link.png`})
  // Delete names them too: Ada is used in 12 docs, two of them only through a link.
  await t.docMenu(page).click()
  await page.getByRole('menuitem', {name: 'Delete'}).click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toContainText('12 documents refer to “Ada Lovelace”', {timeout: 15_000})
  await dialog.getByRole('button', {name: 'Cancel'}).click()
})

test('@local J17: a draft that points away keeps the row while its published version still refers', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the panel reads the docs from the frames')
  await page.goto(t.docPath('author', 'author-alan'))
  await t.settle(page)
  await page.getByRole('button', {name: 'Show document actions'}).click()
  await page.getByRole('menuitem', {name: 'Incoming references'}).click()
  const row = page.locator('a[href*="post-10"]').filter({hasText: 'Fixture post 10', visible: true}).first()
  await expect(row).toBeVisible({timeout: 15_000})
  // Only a draft of post-10 points at Grace; the published post-10 still names Alan.
  await bpMutate([{patch: {id: 'post-10', type: 'post', set: {author: 'author-grace'}}}])
  await page.waitForTimeout(3000)
  await expect(row).toBeVisible()
  await t.resetDoc('post-10', 'post')
})
