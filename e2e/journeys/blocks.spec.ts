import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// J11 evidence, both studios, in post-11's body: insert a callout and edit it
// (Sanity: in a dialog; ours: inline in the canvas), the block "…" menu (Sanity:
// Edit / Remove; ours: Duplicate / Move up / Move down / Delete), move a block,
// insert an image block, an inline object. What each side ends up with goes to
// the annotations; stills + clips go to e2e/evidence/. Not a CI gate (rule 5).
// The inline object is a `chip` (text, tone) on both sides: Sanity's block `of`,
// Barkpark's `blocks.inline` (#22760/#22785); the canvas draws its dialog.
const ID = 'post-11'
const shot = (name: string, step: string) => `evidence/J11-${name}-${step}.png`
test.use({video: 'on'})
test.setTimeout(180_000)

let original: unknown
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (original !== undefined) await target(info).restore(ID, {body: original})
})

const bodyOf = (t: Target, page: Page) => (t.name === 'sanity' ? page.locator('[data-testid="field-body"]') : page.locator('[id="body"]'))
// Every chip in the body, as stored: Sanity's in block children, ours in paragraph content.
const chips = async (t: Target) => {
  const v = await t.docValue(ID, 'body')
  const all = t.name === 'sanity'
    ? ((v as {children?: {_type: string; text?: string; tone?: string}[]}[]) ?? []).flatMap((b) => b.children ?? [])
    : (((v as {blocks?: {content?: {type: string; text?: string; tone?: string}[]}[]})?.blocks ?? []).flatMap((b) => b.content ?? [])).map((c) => ({...c, _type: c.type}))
  return all.filter((c) => c._type === 'chip').map((c) => `${c.text}/${c.tone}`)
}
// Ours: the declared callout is a block named, and labelled on screen, "Callout · <its
// text>" (Barkpark #22846, #22862).
const ourCallout = (page: Page) => page.locator('bp-paper-canvas [role="group"][aria-label="Callout · Callout from J11"]')
const blockKinds = async (t: Target) => {
  const v = await t.docValue(ID, 'body')
  return t.name === 'sanity'
    ? ((v as {_type: string; style?: string}[]) ?? []).map((b) => (b._type === 'block' ? b.style : b._type))
    : (((v as {blocks?: {type: string}[]})?.blocks ?? []).map((b) => b.type))
}

test('@evidence J11: callout and image blocks, block menu, move, inline object', async ({page}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => info.annotations.push({type: what, description: JSON.stringify(v)})
  original = await t.docValue(ID, 'body')
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Content'}).click()
  const body = bodyOf(t, page)
  const para = body.getByText(/Body paragraph for post 11/)
  await expect(para).toBeVisible({timeout: 20_000})
  await page.waitForTimeout(1000)
  note('before', await blockKinds(t))

  // The caret at the end of the first paragraph (one click activates both editors;
  // Sanity's second places the caret).
  await para.click()
  if (t.name === 'sanity') (await page.waitForTimeout(300), await para.click())
  else await expect(body.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
  await page.keyboard.press('End')

  // 1. A callout, edited.
  if (t.name === 'sanity') {
    await body.getByRole('button', {name: 'Insert Callout (block)'}).first().click()
    const dialog = page.getByRole('dialog').last()
    await dialog.getByRole('textbox', {name: 'Text'}).fill('Callout from J11')
    note('callout tones', await dialog.locator('select').first().locator('option').allInnerTexts().catch(() => []))
    await page.screenshot({path: shot(t.name, '1-callout')})
    await page.keyboard.press('Escape')
  } else {
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    // The declared callout (tone + text) wins over the canvas's own (Barkpark #22846):
    // the pick opens our modal with our fields (editBlockObject, Barkpark #23043), as
    // Sanity's does; closing it puts the callout in.
    await page.locator('.bp-slash-item').filter({hasText: 'Callout'}).click()
    const dialog = page.getByRole('dialog', {name: 'Callout'})
    note('callout tones', await dialog.getByRole('combobox').first().locator('option').allInnerTexts())
    await dialog.getByRole('combobox').first().selectOption({label: 'Warning'})
    await dialog.getByRole('textbox', {name: 'Text'}).fill('Callout from J11')
    await page.screenshot({path: shot(t.name, '1-callout')})
    await dialog.getByRole('button', {name: 'Close dialog'}).click()
  }
  // Sanity's block preview shows the type, not the text: count callouts on the server.
  await expect.poll(async () => (await blockKinds(t)).filter((k) => k === 'callout').length, {timeout: 10_000}).toBe(2)
  // Ours: its tone changes in the same dialog (double-click the block).
  if (t.name === 'studio') {
    const tones = async () => (((await t.docValue(ID, 'body')) as {blocks?: {type: string; text?: string; tone?: string}[]})?.blocks ?? []).filter((b) => b.text === 'Callout from J11').map((b) => b.tone)
    await expect.poll(tones, {timeout: 10_000}).toEqual(['warning'])
    await ourCallout(page).dblclick()
    const dialog = page.getByRole('dialog', {name: 'Callout'})
    await dialog.getByRole('combobox').first().selectOption({label: 'Danger'})
    await dialog.getByRole('button', {name: 'Close dialog'}).click()
    await expect.poll(tones, {timeout: 10_000}).toEqual(['danger'])
    note('callout tone edit', await tones())
    await expect(ourCallout(page)).toHaveText('Callout · Callout from J11')
    // The command palette's Insert Callout opens the same dialog (#22861), by keyboard
    // alone: focus lands on its first field, Tab reaches the next, Escape closes it and
    // gives focus back to the canvas (#22892). Closed, it inserts nothing.
    await ourCallout(page).click()
    await page.keyboard.press('ControlOrMeta+p')
    await page.keyboard.type('Insert Callout')
    await page.keyboard.press('Enter')
    const tone = dialog.getByRole('combobox').first()
    await expect(tone).toBeFocused()
    note('palette callout dialog', await tone.locator('option').allInnerTexts())
    // Tab reaches Text past Tone's field actions (as in every field of ours).
    const text = dialog.getByRole('textbox', {name: 'Text'})
    for (let i = 0; i < 4 && !(await text.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(text).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => !!document.activeElement?.closest('bp-paper-canvas')), 'focus back in the canvas').toBe(true)
    expect((await blockKinds(t)).filter((k) => k === 'callout')).toHaveLength(2)
  }

  // 2. The block "…" menu on it.
  const callout = t.name === 'sanity' ? body.locator('[data-testid="pte-block-object"]').last() : ourCallout(page)
  await callout.hover()
  await page.waitForTimeout(400)
  if (t.name === 'sanity') {
    await callout.getByRole('button', {name: 'Open menu'}).click()
  } else {
    await page.getByRole('button', {name: 'Block options'}).first().click()
  }
  await page.waitForTimeout(500)
  const menuItems = await page.evaluate(() =>
    [...document.querySelectorAll('[role=menu] [role=menuitem], .bp-block-menu__item')].filter((m) => (m as HTMLElement).offsetParent !== null).map((m) => (m.textContent ?? '').replace(/[^\w ]/g, '').trim()),
  )
  note('block menu', menuItems)
  await page.screenshot({path: shot(t.name, '2-block-menu')})
  // Ours: Duplicate (then Delete the copy); Sanity has no duplicate here: close.
  if (t.name === 'studio') {
    await page.locator('.bp-block-menu__item').filter({hasText: 'Duplicate'}).click()
    await expect(ourCallout(page)).toHaveCount(2)
    await ourCallout(page).last().hover()
    await page.getByRole('button', {name: 'Block options'}).first().click()
    await page.locator('.bp-block-menu__item').filter({hasText: 'Delete'}).click()
    await expect(ourCallout(page)).toHaveCount(1)
  } else await page.keyboard.press('Escape')

  // 3. Move the callout up one block (ours: the menu's Move up; Sanity: drag its handle).
  if (t.name === 'studio') {
    await callout.hover()
    await page.getByRole('button', {name: 'Block options'}).first().click()
    await page.locator('.bp-block-menu__item').filter({hasText: 'Move up'}).click()
  } else {
    const handle = callout.locator('[data-drag-handle], [data-ui="DragHandle"]').first()
    const above = await para.boundingBox({timeout: 3_000}).catch(() => null)
    if ((await handle.count()) && above) {
      const h = (await handle.boundingBox())!
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
      await page.mouse.down()
      await page.mouse.move(above.x + 10, above.y + 2, {steps: 10})
      await page.mouse.up()
    } else note('sanity drag', 'no drag handle found under automation')
  }
  await page.waitForTimeout(2000)
  note('after move', await blockKinds(t))
  await page.screenshot({path: shot(t.name, '3-moved')})

  // 4. An image block, 5. an inline object (a chip: text + tone, in its own dialog).
  if (t.name === 'sanity') {
    note('image block', 'Insert Image (block) → a dialog to upload/select (see the clip)')
    // The caret at the end of a paragraph; Chip is on the toolbar, or in its "…" when narrow.
    await body.getByText(/written with/).click({timeout: 5_000}).catch(() => {})
    await page.keyboard.press('End')
    const chipButton = body.getByRole('button', {name: 'Insert Chip (inline)'}).first()
    if (await chipButton.isVisible()) await chipButton.click()
    else {
      await body.locator('[data-testid="insert-menu-button"]').first().click({timeout: 5_000}).catch(() => {})
      await page.getByRole('menuitem', {name: 'Chip'}).click({timeout: 5_000}).catch(() => note('inline insert', 'no Chip in the toolbar or its menu'))
    }
    // "Edit Chip": a popover with Text and Tone.
    const dlg = page.locator('div').filter({has: page.getByText('Edit Chip', {exact: true})}).filter({has: page.locator('select')}).last()
    await dlg.getByRole('textbox').first().fill('Draft', {timeout: 5_000}).catch(() => note('inline text', 'no Text input'))
    await dlg.locator('select').first().selectOption({label: 'Caution'}, {timeout: 3_000}).catch(() => note('inline tone', 'no Tone control'))
    await page.screenshot({path: shot(t.name, '4-inline')})
    await page.keyboard.press('Escape')
    await expect.poll(() => chips(t), {timeout: 10_000}).toContain('Draft/caution').catch(() => {})
    note('inline object', await chips(t))
  } else {
    // The caret must be in that paragraph, not left in the callout typed above
    // (a "/" typed there is text, and no menu opens).
    const inPara = () => page.evaluate(() => /Body paragraph for post 11/.test(getSelection()?.focusNode?.textContent ?? ''))
    await expect(async () => {
      await page.locator('bp-paper-canvas').getByText(/Body paragraph for post 11/).click({timeout: 3_000})
      expect(await inPara()).toBe(true)
    }).toPass({timeout: 10_000})
    // At a person's pace. Within ~10 ms of the click (only Playwright is that fast) the
    // canvas has not yet taken the new selection after a Move up, and Enter acts on the
    // old one, in the moved callout (task-b2abe773242241f8 has the timeline).
    await page.waitForTimeout(100)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    // Expected: an empty new paragraph. After the Move up above, Enter can put the
    // caret into the moved callout instead (task in the J11 note); "/" is then text.
    note('caret after Enter', await page.evaluate(() => getSelection()?.focusNode?.textContent?.slice(0, 40) ?? ''))
    await page.keyboard.type('/')
    const item = page.locator('.bp-slash-item[data-type="image"]')
    await item.scrollIntoViewIfNeeded({timeout: 5_000}).catch(() => {})
    await item.click({timeout: 5_000}).catch(() => note('image item', 'not clickable'))
    // Our library dialog opens on it, as Sanity's (mediaPicker, #538): pick the first picture.
    const library = page.getByRole('dialog').filter({hasText: 'Select image'})
    // The first tile showing a real picture (the library also holds blank test uploads).
    const tiles = library.locator('.asset-pick')
    await tiles.first().waitFor({timeout: 10_000})
    await page.waitForTimeout(800)
    const real = await tiles.evaluateAll((els) => els.findIndex((el) => { const img = el.querySelector('img'); return !!img && img.naturalWidth > 64 }))
    await tiles.nth(Math.max(real, 0)).click()
    // The picture itself in the block, loaded.
    await expect.poll(() => page.locator('bp-paper-canvas .bp-canvas-image-img[src]').last().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {timeout: 10_000}).toBe(true)
    await expect(library).toHaveCount(0)
    // Saved with the next batch, a moment after the pick.
    const saved = await expect.poll(async () => (await blockKinds(t)).includes('image'), {timeout: 10_000}).toBe(true).then(() => true, () => false)
    note('image block', saved ? 'inserted' : 'not inserted (no / menu: see caret after Enter)')
    await page.screenshot({path: shot(t.name, '4-image')})
    // 5. A chip, from the slash menu: our modal over the pane, as Sanity's inline
    // object dialog (editBlockObject, Barkpark #23043), so it is never cut off.
    await page.locator('bp-paper-canvas').getByText(/Body paragraph for post 11/).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/chip')
    await page.locator('.bp-slash-menu').filter({visible: true}).getByText('Chip').click({timeout: 5_000}).catch(() => page.keyboard.press('Enter'))
    const dlg = page.getByRole('dialog').filter({has: page.getByRole('heading', {name: /chip/i})})
    await dlg.getByRole('textbox').first().fill('Draft')
    const toneSelect = dlg.locator('select').first()
    await toneSelect.selectOption({label: await toneSelect.locator('option', {hasText: /^caution$/i}).innerText()})
    await page.screenshot({path: shot(t.name, '4-inline')})
    await dlg.getByRole('button', {name: 'Close dialog'}).click()
    await expect.poll(() => chips(t), {timeout: 10_000}).toContain('Draft/caution')
    await expect(page.locator('bp-paper-canvas [aria-label="Chip: Draft"]')).toBeVisible()
    note('inline object', await chips(t))
  }
  note('after', await blockKinds(t))
})
