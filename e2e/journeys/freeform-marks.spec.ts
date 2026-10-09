import {expect, test, type Locator, type Page} from '@playwright/test'
import {bpMutate, target} from '../rig/targets'

// D18 (Freeform side track, ours only), after Barkdown's EDITOR-PARITY rows 2 and 14 and
// its #20/#21 rows: in a fresh note's canvas, the selection bubble marks a word struck,
// code, underlined, highlighted, subscript and superscript; so do Barkdown's keys (Mod+,
// Mod+. Mod+Shift+H) and shorthands (~~ == `); `####`, `#####` and `######`
// make headings 4–6; `[ ] ` and Tab make a nested checklist; the bubble centres a
// paragraph and flushes a heading right. The server holds each one, and a reload mounts
// them all again. Stills in e2e/evidence/D18-*.
const ID = `note-d18-${Date.now().toString(36)}` // fresh each run: a reused id carries its delete in its history
const MARKS = ['strike', 'code', 'underline', 'highlight', 'subscript', 'superscript'] as const
type Inline = {type: string; value?: string; children?: Inline[]}
type Block = {type: string; text?: string; level?: number; align?: string; task?: boolean; content?: Inline[]; items?: {checked?: boolean; content?: Inline[]; children?: Block[]}[]}
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})

const mutate = (mutations: unknown[]) => bpMutate(mutations).then(() => {})
test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio') await mutate([{delete: {id: ID, type: 'note', force: true}}]).catch(() => {})
})

/** Click into a block's text, then the beat a person always gives (task-f24549dea0618da2). */
async function caretIn(page: Page, at: Locator, key = 'End') {
  await at.click()
  await page.waitForTimeout(100)
  await page.keyboard.press(key)
}
/** Select `len` characters from `from` in a block, by keyboard. */
async function selectIn(page: Page, at: Locator, from: number, len: number) {
  await caretIn(page, at, 'Home')
  for (let i = 0; i < from; i++) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < len; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(150)
}

test('@local D18: strike, code, underline, highlight, sub/sup; headings 4–6; nested checklist; alignment — held and reloaded', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  test.setTimeout(90_000)
  await mutate([
    {
      createOrReplace: {
        _id: ID,
        _type: 'note',
        title: 'D18 marks',
        label: 'Idea',
        body: {blocks: [...MARKS.map((m) => para(m, `Mark ${m} here.`)), para('centre', 'Centre this line.'), {id: 'right', type: 'heading', level: 2, content: [{type: 'text', value: 'Right heading'}]}, para('keys', 'Water is H2O and mc2.'), para('end', 'The end.')]},
      },
    },
    {publish: {id: ID, type: 'note'}},
  ])
  await page.goto(t.docPath('note', ID))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')
  const block = (text: string) => canvas.locator('.ProseMirror > *', {hasText: text}).first()
  const blocks = async () => ((await t.docValue(ID, 'blocks', 'note')) as Block[]) ?? []
  const bubble = (name: string) => page.locator(`.bp-paper-format__btn--${name}`).first()

  // 1. Marks from the bubble: select the word, press its button.
  for (const m of MARKS) {
    await selectIn(page, block(`Mark ${m} here.`), 5, m.length)
    await bubble(m).click()
  }

  // 2. Alignment from the bubble.
  await selectIn(page, block('Centre this line.'), 0, 6)
  await bubble('align-center').click()
  await selectIn(page, block('Right heading'), 0, 5)
  await bubble('align-right').click()

  // Keys, as Barkdown's: Mod+, subscript, Mod+. superscript, Mod+Shift+H highlight.
  await selectIn(page, block('Water is H2O'), 10, 1)
  await page.keyboard.press('ControlOrMeta+,')
  await selectIn(page, block('Water is H2O'), 19, 1)
  await page.keyboard.press('ControlOrMeta+.')
  await selectIn(page, block('Water is H2O'), 0, 5)
  await page.keyboard.press('ControlOrMeta+Shift+h')

  // 3. Headings 4–6 and a nested checklist by shorthand, after the last line.
  await caretIn(page, block('The end.'))
  for (const [hashes, text] of [['####', 'Four'], ['#####', 'Five'], ['######', 'Six']]) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(`${hashes} ${text}`)
  }
  await page.keyboard.press('Enter')
  await page.keyboard.type('[ ] Parent task')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Child task')
  // Markdown shorthands for the marks, on a line of their own.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.type('Short ~~gone~~ and ==lit== and `mono` done')
  // The child's box ticked.
  await canvas.locator('li', {hasText: 'Child task'}).last().locator('input[type="checkbox"]').check()

  // 4. The server holds each one.
  const inline = (xs: Inline[] = []): string => xs.map((x) => (x.type === 'text' ? x.value : x.type === 'code' ? `<code>${x.value}</code>` : `<${x.type}>${inline(x.children)}</${x.type}>`)).join('')
  const shape = (b: Block): string =>
    b.type === 'list' ? `list${b.task ? ' task' : ''} ${b.items!.map((it) => `[${it.checked ? 'x' : ' '}] ${inline(it.content)}${(it.children ?? []).map((c) => ` > ${shape(c)}`).join('')}`).join(' / ')}` : `${b.type}${b.level ? b.level : ''}${b.align ? ` ${b.align}` : ''} ${b.text ?? inline(b.content)}`
  const want = [
    'paragraph Mark <strikethrough>strike</strikethrough> here.',
    'paragraph Mark <code>code</code> here.',
    'paragraph Mark <underline>underline</underline> here.',
    'paragraph Mark <highlight>highlight</highlight> here.',
    'paragraph Mark <sub>subscript</sub> here.',
    'paragraph Mark <sup>superscript</sup> here.',
    'paragraph center Centre this line.',
    'heading2 right Right heading',
    'paragraph <highlight>Water</highlight> is H<sub>2</sub>O and mc<sup>2</sup>.',
    'paragraph The end.',
    'heading4 Four',
    'heading5 Five',
    'heading6 Six',
    'list task [ ] Parent task > list task [x] Child task',
    'paragraph Short <strikethrough>gone</strikethrough> and <highlight>lit</highlight> and <code>mono</code> done',
  ]
  const server = async () => (await blocks()).filter((b) => !b.type.startsWith('field-')).map(shape)
  await expect.poll(server, {timeout: 10_000}).toEqual(want)
  await page.screenshot({path: 'evidence/D18-1-edited-studio.png'})

  // 5. A reload mounts them all again.
  await page.reload()
  await t.settle(page)
  const dom = await canvas.locator('.ProseMirror').evaluate((pm) => ({
    marks: ['s', 'code', 'u', 'mark', 'sub', 'sup'].map((tag) => [...pm.querySelectorAll(tag)].map((e) => e.textContent).join()),
    headings: [...pm.querySelectorAll('h4, h5, h6')].map((h) => `${h.tagName} ${h.textContent}`),
    aligned: [...pm.querySelectorAll('[style*="text-align"]')].map((e) => `${e.tagName} ${(e as HTMLElement).style.textAlign}`),
    checked: [...pm.querySelectorAll('ul ul input[type="checkbox"]')].map((c) => (c as HTMLInputElement).checked),
  }))
  expect(dom).toEqual({
    marks: ['strike,gone', 'code,mono', 'underline', 'highlight,Water,lit', 'subscript,2', 'superscript,2'],
    headings: ['H4 Four', 'H5 Five', 'H6 Six'],
    aligned: ['P center', 'H2 right'],
    checked: [true],
  })
  await expect.poll(server).toEqual(want) // the reload wrote nothing
  await page.screenshot({path: 'evidence/D18-2-reloaded-studio.png'})
})
