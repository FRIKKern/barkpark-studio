import {expect, test, type Page} from '../rig/test'
import {target} from '../rig/targets'

// Canvas 1.14.0 shows a block-cards body's link as Sanity's annotation pill, at the caret,
// in place of the hover card (Freeform keeps the card). These checks follow the deployed canvas.
const pillCanvas = (page: Page) =>
  page.evaluate(() => {
    const v = (customElements.get('bp-paper-editor') as {CONTRACT_VERSION?: string} | undefined)?.CONTRACT_VERSION ?? ''
    const [a = 0, b = 0] = v.split('.').map(Number)
    return a > 1 || (a === 1 && b >= 14)
  })

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
  await expect.poll(() => tab.url(), {intervals: [50]}).toContain('example.com')
  await tab.close()
  await page.bringToFront()
  // The card goes when the pointer leaves for a while.
  await page.mouse.move(5, 5)
  await expect(page.locator('.bp-link-preview__title').filter({visible: true})).toHaveCount(0, {timeout: 5000})
  await page.waitForTimeout(1000) // the canvas's hover intent: a card right after another doesn't open

  // A wikilink.
  await canvas.getByText('the second note').hover()
  await expect(page.locator('.bp-link-preview__title').filter({visible: true})).toHaveText('Fixture note 02')
  await expect(page.locator('.bp-link-preview__addr--subtitle').filter({visible: true})).toHaveText('Second note.')
  await page.screenshot({path: 'evidence/D06-1-hover-studio.png'})
  await page.locator('.bp-link-preview__open').filter({visible: true}).click()
  await expect(page).toHaveURL(/\/structure\/note;note-01;note-02$/)
  await expect(page.locator('[data-pane="doc:note-02"] bp-paper-canvas')).toContainText('Second note.', {timeout: 15_000})
  await page.screenshot({path: 'evidence/D06-2-opened-studio.png'})
  await page.goBack()
  await expect(page).toHaveURL(/\/structure\/note;note-01$/)

})

// task-398773ee95fad121, as Sanity's: in a post's Body field (not only a Freeform doc) an
// internal link's Open opens its document in the next pane; a read-only body follows the
// link itself (click or Enter). post-11's second paragraph links "Ada" to author-ada.
test('@local D06: an internal link in a body field opens its document; a read-only body follows it', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity opens it the same (scout 2026-10-16)')
  await page.goto(t.docPath('post', 'post-11'))
  await t.settle(page)
  const body = page.locator('[data-pane="doc:post-11"] .body-canvas')
  await body.getByText('Body paragraph for post 11.').click()
  await expect(body.locator('.ProseMirror')).toBeVisible({timeout: 15_000})
  const ada = body.locator('.ProseMirror').getByText('Ada', {exact: true})
  if (await pillCanvas(page)) await ada.click()
  else await ada.hover()
  const open = page.locator('.bp-link-preview__open').filter({visible: true})
  await expect(open).toBeVisible()
  await open.click()
  await expect(page).toHaveURL(/\/structure\/post;post-11[^;]*;author-ada,type=author$/, {timeout: 15_000}) // after the target's type is read
  await expect(page.locator('[data-pane="doc:author-ada"] [id="name"]')).toHaveValue('Ada Lovelace')

  await page.goto(`${t.docPath('post', 'post-11')}?perspective=published`)
  await t.settle(page)
  const link = page.locator('[data-pane="doc:post-11"] .body-static [data-wikilink][role=link]')
  await expect(link).toHaveText('Ada')
  await link.click()
  await expect(page).toHaveURL(/\/structure\/post;post-11[^;]*;author-ada,type=author\?perspective=published$/)
  await expect(page.locator('[data-pane="doc:author-ada"] [id="name"]')).toHaveValue('Ada Lovelace')
  await page.goBack()
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/author-ada,type=author/)
})

// task-4427f3dacf001bfa, task-bf274820b1c5e9e5 (canvas 1.9): a link's card has Remove, which
// drops the whole link (here across bold and plain), or a document link, in one click, as Sanity's Remove
// annotation; a document link's card is Sanity's preview: title, subtitle and type, once each.
test('@local D06: a body link card has Remove; a document link shows its preview', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the card is the canvas; Sanity checked by hand (scout 2026-10-16)')
  const id = `post-linkcard-${Date.now().toString(36)}`
  const text = (value: string) => ({type: 'text', value})
  const content = [text('See '), {type: 'link', href: 'https://example.com/', children: [{type: 'strong', children: [text('the out')]}, text('side page')]}, text(' and '), {type: 'wikilink', target: 'post-02', docId: 'post-02', children: [text('post two')]}, text('.')]
  await t.draftOnly(id, 'post', {title: `Link card ${id.slice(-6)}`, slug: {_type: 'slug', current: id}, body: {blocks: [{id: 'b1', type: 'paragraph', content}]}})
  try {
    await page.goto(t.docPath('post', id))
    await t.settle(page)
    const body = page.locator(`[data-pane="doc:${id}"] .body-canvas`)
    await body.getByText('post two').click()
    const pm = body.locator('.ProseMirror')
    await expect(pm).toBeVisible({timeout: 15_000})
    const kinds = (nodes: {type: string; children?: unknown[]}[]): string[] => nodes.flatMap((n) => [n.type, ...kinds((n.children ?? []) as never)])
    const stored = async () => {
      const doc = (await t.docValue(id, 'body')) as {blocks?: {content: {type: string}[]}[]} | undefined
      return doc?.blocks?.[0] ? kinds(doc.blocks[0].content).filter((k) => k !== 'text') : null
    }
    if (await pillCanvas(page)) {
      // The pill: named by the annotation type (Sanity's start-cased name, no schema title
      // here), Open only on the document link, Edit and Remove as Sanity's.
      const pill = page.locator('.bp-link-pill').filter({visible: true})
      await pm.getByText('post two').click()
      await expect(pill.locator('.bp-link-pill__label')).toHaveText('Internal Link')
      await expect(pill.getByRole('button', {name: 'Open'})).toBeVisible()
      await expect(pill.getByRole('button', {name: 'Edit annotation'})).toBeVisible()
      await pm.getByText('side page').click()
      await expect(pill.locator('.bp-link-pill__label')).toHaveText('Link')
      await expect(pill.getByRole('button', {name: 'Open'})).toBeHidden()
      await pill.getByRole('button', {name: 'Remove annotation'}).click()
      await expect(pm).toContainText('See the outside page and post two.')
      await expect.poll(stored, {timeout: 15_000}).toEqual(['strong', 'wikilink'])
      await pm.getByText('post two').click()
      await pill.getByRole('button', {name: 'Remove annotation'}).click()
      await expect.poll(stored, {timeout: 15_000}).toEqual(['strong'])
      await expect(pm).toContainText('See the outside page and post two.')
      return
    }
    const card = page.locator('.bp-link-preview').filter({visible: true})
    await pm.getByText('post two').hover()
    await expect(card.locator('.bp-link-preview__title')).toHaveText('Fixture post 02')
    await expect(card.locator('.bp-link-preview__badge')).toHaveText('Post')
    await expect(card.locator('.bp-link-preview__addr')).toHaveText('Grace Hopper')
    await expect(card.locator('.bp-link-preview__excerpt')).toBeHidden()
    await page.mouse.move(5, 5)
    await expect(card).toHaveCount(0, {timeout: 5000})
    await page.waitForTimeout(1000) // the canvas's hover intent
    await pm.getByText('side page').hover()
    await card.getByRole('button', {name: 'Remove'}).click()
    await expect(pm).toContainText('See the outside page and post two.')
    // Stored: the link gone, its bold kept, the document link untouched.
    await expect.poll(async () => {
      const doc = (await t.docValue(id, 'body')) as {blocks?: {content: {type: string}[]}[]} | undefined
      return doc?.blocks?.[0] ? kinds(doc.blocks[0].content).filter((k) => k !== 'text') : null
    }, {timeout: 15_000}).toEqual(['strong', 'wikilink'])
    // And a document link's Remove (task-7b0601d04fdc4bdb).
    await page.mouse.move(5, 5)
    await expect(card).toHaveCount(0, {timeout: 5000})
    await page.waitForTimeout(1000)
    await pm.getByText('post two').hover()
    await card.getByRole('button', {name: 'Remove'}).click()
    await expect.poll(async () => {
      const doc = (await t.docValue(id, 'body')) as {blocks?: {content: {type: string}[]}[]} | undefined
      return doc?.blocks?.[0] ? kinds(doc.blocks[0].content).filter((k) => k !== 'text') : null
    }, {timeout: 15_000}).toEqual(['strong'])
    await expect(pm).toContainText('See the outside page and post two.')
  } finally {
    await t.deleteDoc(id, 'post')
  }
})

// Barkdown's EDITOR-PARITY row 2: Cmd/Ctrl+K on a selection in the canvas opens its link
// row, and the Studio's own Cmd/Ctrl+K search stays shut (J19 holds the search key elsewhere).
test('@local D18: Cmd/Ctrl+K on a selection is the canvas link row, not search', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.goto(t.docPath('note', 'note-02'))
  await t.settle(page)
  await page.locator('bp-paper-canvas').getByText('Second note.').waitFor({timeout: 20_000})
  await expect(page.locator('.pd-status')).toHaveText('Saved')
  await page.waitForTimeout(500) // the canvas parks its caret once ready; select after that
  await page.evaluate(() => {
    const ed = (document.querySelector('bp-paper-canvas') as unknown as {_editor: {state: {doc: {forEach(f: (n: {textContent: string; nodeSize: number}, o: number) => void): void}}; chain(): {focus(): {setTextSelection(r: {from: number; to: number}): {run(): void}}}}})._editor
    let at = 0
    ed.state.doc.forEach((n, o) => void (n.textContent === 'Second note.' && (at = o + 1)))
    ed.chain().focus().setTextSelection({from: at, to: at + 6}).run()
  })
  const search = page.getByRole('dialog').filter({has: page.getByRole('combobox')})
  await page.keyboard.press(`${MOD}+k`)
  await expect(page.locator('body .bp-paper-format__link-row')).toBeVisible()
  await expect(search).toHaveCount(0)
})
