import {expect, test, type Locator, type Page} from '@playwright/test'
import {bpMutate, target} from '../rig/targets'

// D09 (Freeform side track, ours only), in a fresh note's canvas: the block gutter is
// whole and clickable inside the pane (+ and grip were clipped by the pane edge);
// Cmd/Ctrl+Shift+↑ moves a block, Cmd/Ctrl+D duplicates one, the slash menu inserts a
// quote, the grip drags a block to the top; markdown, an HTML list and a URL over a
// selection paste as blocks / a link. The server holds each result. Stills in
// e2e/evidence/D09-*.
const ID = `note-d09-${Date.now().toString(36)}` // fresh each run: a reused id carries its delete in its history
type Block = {type: string; text?: string; level?: number; href?: string; content?: Inline[]; items?: Inline[][]}
type Inline = {type: string; value?: string; href?: string; children?: Inline[]}
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})
const flat = (xs: Inline[] = []): string => xs.map((x) => (x.type === 'link' ? `[${flat(x.children)}](${x.href})` : x.value ?? flat(x.children))).join('')
/** A block as one line: "paragraph Alpha.", "list a / b", … */
const line = (b: Block) => `${b.type} ${b.text ?? (b.items ? b.items.map(flat).join(' / ') : flat(b.content))}`.trim()

// The rig's writer: it waits out a 429 (the suite shares one token's budget).
const mutate = (mutations: unknown[]) => bpMutate(mutations).then(() => {})
test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio') await mutate([{delete: {id: ID, type: 'note', force: true}}]).catch(() => {})
})

/** Click into a block's text, then give the editor the beat a person always does: a
 *  key pressed within ~20 ms of a click or a selecting key still acts on the previous
 *  caret (canvas, task-f24549dea0618da2). */
async function caretIn(page: Page, at: Locator, end = true) {
  await at.click()
  await page.waitForTimeout(100)
  if (end) await page.keyboard.press('End')
}

test('@local D09: block gutter, keyboard moves, slash menu, drag; markdown/HTML/URL paste', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  test.setTimeout(60_000)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const clip = (data: Record<string, string>) =>
    page.evaluate((data) => navigator.clipboard.write([new ClipboardItem(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, new Blob([v], {type: k})])))]), data)
  const body = async () => (((await t.docValue(ID, 'blocks', 'note')) as Block[]) ?? []).filter((b) => !b.type.startsWith('field-')).map(line)
  const saved = (want: string[]) => expect.poll(body, {timeout: 10_000}).toEqual(want)

  await mutate([
    {createOrReplace: {_id: ID, _type: 'note', title: 'D09 blocks', label: 'Idea', body: {blocks: [para('a', 'Alpha.'), para('b', 'Beta here.'), para('c', 'Gamma.')]}}},
    {publish: {id: ID, type: 'note'}},
  ])
  await page.goto(t.docPath('note', ID))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')
  const block = (text: string) => canvas.locator('.ProseMirror > *', {hasText: text}).first()

  // The gutter: both buttons inside the doc pane and on top (not under the list pane).
  await block('Gamma.').hover()
  for (const name of ['Add a block below', 'Block options']) {
    const hit = await page.getByRole('button', {name}).evaluate((b) => {
      const r = b.getBoundingClientRect()
      const pane = b.closest('[data-pane-index]')!.getBoundingClientRect()
      return r.left >= pane.left && b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })
    expect(hit, `${name} is whole and clickable`).toBe(true)
  }

  // Keyboard: move Beta up, then duplicate Gamma.
  await caretIn(page, block('Beta here.'))
  await page.keyboard.press(`${mod}+Shift+ArrowUp`)
  await caretIn(page, block('Gamma.'))
  await page.keyboard.press(`${mod}+d`)
  await saved(['paragraph Beta here.', 'paragraph Alpha.', 'paragraph Gamma.', 'paragraph Gamma.'])
  expect(page.url(), 'the studio takes none of the canvas keys').toContain(`;${ID}`)

  // Slash menu: a quote at the end.
  await caretIn(page, canvas.locator('.ProseMirror > *', {hasText: 'Gamma.'}).last())
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await expect(page.locator('.bp-slash-label', {hasText: 'Quote'}).first()).toBeVisible()
  await page.screenshot({path: 'evidence/D09-1-slash-studio.png'})
  await page.keyboard.type('quote')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Quoted.')
  await saved(['paragraph Beta here.', 'paragraph Alpha.', 'paragraph Gamma.', 'paragraph Gamma.', 'blockquote Quoted.'])

  // Drag the quote's grip to the top.
  await block('Quoted.').hover()
  const grip = (await page.getByRole('button', {name: 'Block options'}).boundingBox())!
  const top = (await block('Beta here.').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2, top.y + 8, {steps: 8})
  await page.mouse.move(grip.x + grip.width / 2, top.y - 2, {steps: 4})
  await page.screenshot({path: 'evidence/D09-2-drag-studio.png'})
  await page.mouse.up()
  await saved(['blockquote Quoted.', 'paragraph Beta here.', 'paragraph Alpha.', 'paragraph Gamma.', 'paragraph Gamma.'])

  // Paste markdown, then an HTML list, after Alpha; then a URL over "Beta".
  await clip({'text/plain': '## Pasted\n\n- one\n- two'})
  await caretIn(page, block('Alpha.'))
  await page.keyboard.press('Enter')
  await page.keyboard.press(`${mod}+v`)
  await clip({'text/html': '<ul><li>html one</li><li>html <b>two</b></li></ul>', 'text/plain': 'html one\nhtml two'})
  await caretIn(page, block('Alpha.'))
  await page.keyboard.press('Enter')
  await page.keyboard.press(`${mod}+v`)
  await clip({'text/plain': 'https://barkpark.cloud/'})
  await caretIn(page, block('Beta here.'), false)
  await page.keyboard.press('Home')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(100) // the same beat: the paste must see the selection
  await page.keyboard.press(`${mod}+v`)
  await saved([
    'blockquote Quoted.',
    'paragraph [Beta](https://barkpark.cloud/) here.',
    'paragraph Alpha.',
    'list html one / html two',
    'heading Pasted',
    'list one / two',
    'paragraph Gamma.',
    'paragraph Gamma.',
  ])
  await page.screenshot({path: 'evidence/D09-3-pasted-studio.png'})
})
