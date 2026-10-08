import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target} from '../rig/targets'

// J11 evidence, both studios, in post-11's body: insert a callout and edit it
// (Sanity: in a dialog; ours: inline in the canvas), the block "…" menu (Sanity:
// Edit / Remove; ours: Duplicate / Move up / Move down / Delete), move a block,
// insert an image block, an inline object. What each side ends up with goes to
// the annotations; stills + clips go to e2e/evidence/. Not a CI gate (rule 5).
// Ours can't yet: inline objects (task-85fee859cf3bfef6).
const ID = 'post-11'
const shot = (name: string, step: string) => `evidence/J11-${name}-${step}.png`
test.use({video: 'on'})
test.setTimeout(180_000)

let original: unknown
test.afterEach(async ({}, info) => {
  if (original !== undefined) await target(info).restore(ID, {body: original})
})

const bodyOf = (t: Target, page: Page) => (t.name === 'sanity' ? page.locator('[data-testid="field-body"]') : page.locator('[id="body"]'))
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
    await page.screenshot({path: shot(t.name, '1-callout')})
    await page.keyboard.press('Escape')
  } else {
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await page.locator('.bp-slash-item').filter({hasText: 'Callout'}).click()
    await page.keyboard.type('Callout from J11')
    await page.screenshot({path: shot(t.name, '1-callout')})
  }
  // Sanity's block preview shows the type, not the text: count callouts on the server.
  await expect.poll(async () => (await blockKinds(t)).filter((k) => k === 'callout').length, {timeout: 10_000}).toBe(2)

  // 2. The block "…" menu on it.
  const callout = t.name === 'sanity' ? body.locator('[data-testid="pte-block-object"]').last() : body.getByText('Callout from J11')
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
    await expect(body.getByText('Callout from J11')).toHaveCount(2)
    await body.getByText('Callout from J11').last().hover()
    await page.getByRole('button', {name: 'Block options'}).first().click()
    await page.locator('.bp-block-menu__item').filter({hasText: 'Delete'}).click()
    await expect(body.getByText('Callout from J11')).toHaveCount(1)
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

  // 4. An image block, 5. an inline object: recorded, not judged (gaps on ours).
  if (t.name === 'sanity') {
    note('image block', 'Insert Image (block) → a dialog to upload/select (see the clip)')
    note('inline object', 'Insert Chip (inline) → a chip with its own dialog')
    await body.getByRole('button', {name: 'Insert Chip (inline)'}).first().click({timeout: 5_000}).catch(() => {})
    await page.waitForTimeout(800)
    await page.screenshot({path: shot(t.name, '4-inline')})
    await page.keyboard.press('Escape')
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
    // Saved with the next batch, a moment after the pick.
    const saved = await expect.poll(async () => (await blockKinds(t)).includes('image'), {timeout: 10_000}).toBe(true).then(() => true, () => false)
    note('image block', saved ? 'inserted' : 'not inserted (no / menu: see caret after Enter)')
    note('inline object', 'none in the vocabulary (PortableDoc has no inline objects)')
    await page.screenshot({path: shot(t.name, '4-image')})
  }
  note('after', await blockKinds(t))
})
