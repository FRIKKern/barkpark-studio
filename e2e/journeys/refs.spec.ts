import {expect, test} from '../rig/test'
import {installProbes, timeToReady} from '../rig/feel'
import {target, closeAndSettle} from '../rig/targets'
import {referenceHold} from '../rig/reference'

// The URL and the test's own flags cost nothing to read: every 50 ms, not the default
// backoff (up to 1 s past the moment they change).
const PAGE_POLL = {intervals: [50]}

// Crown references, same steps on both studios: J08 (pick by search, open in the
// next pane), J22 (create a new doc from the field). J23 (parents follow, live, in a
// second browser) is refs-follow.spec, J17 (where a doc is used) refs-used-in.spec: split
// for CI's shards (task-c1df532bed870536). Budgets apply to ours.
const ID = 'post-07' // author: Alan Turing

test.beforeEach(async ({context}, info) => {
  await Promise.all([target(info).prepare(context), installProbes(context)])
})
const created: string[] = []
test.afterEach(async ({page}, info) => {
  const t = target(info)
  // A save the page still has on its way (a replaced author, a new author's name) would
  // land after the restore and leave a draft behind for the next run.
  await closeAndSettle(page)
  // Each a different doc: all at once.
  await Promise.all([t.restore(ID, {author: t.ref('author-alan')}), ...created.splice(0).map((id) => t.deleteDoc(id, 'author'))])
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
  await expect.poll(documentPath, PAGE_POLL).toBe(t.docPath('post', ID))
  await referenceHold(page, t.refLink(pane, 'author'))

  const opened = await timeToReady(page, t.refLink(pane, 'author'), `() => location.pathname.includes('author-grace')`, null)
  await expect(t.field(page, 'name')).toHaveValue('Grace Hopper')
  await expect.poll(documentPath, PAGE_POLL).toBe(`${t.docPath('post', ID)};author-grace`)
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
    await expect.poll(() => held, PAGE_POLL).toBe(true)
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
  await expect.poll(() => decodeURIComponent(page.url()), PAGE_POLL).toContain(';author-ada,type=author,parentRefPath=author')
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
      await expect.poll(() => held, PAGE_POLL).toBe(true)
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
    // Two docs, polled at once.
    await Promise.all([
      expect.poll(() => t.docValue(id!, 'name', 'author').catch(() => undefined)).toBe('Barbara Liskov II'),
      expect.poll(async () => {
        const value = await t.docValue(ID, 'author')
        // Sanity adds weak/strengthen-on-publish metadata for a new draft.
        return typeof value === 'string' ? value : (value as {_ref?: string} | null)?._ref
      }).toBe(id),
    ])
    await referenceHold(page, name, 'Barbara Liskov II')
  } finally {
    release?.()
    await page.context().setOffline(false)
    await page.unrouteAll({behavior: 'ignoreErrors'})
  }
})
