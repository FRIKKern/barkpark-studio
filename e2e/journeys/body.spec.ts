import {expect, test, type Locator, type Page} from '@playwright/test'
import {installProbes, stats} from '../rig/feel'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// J10 evidence, both studios, in post-10's body: markdown shortcuts (## heading,
// - and 1. lists, > quote; ours: a pullquote block), marks by keyboard (Ctrl+B / Ctrl+I), heading 3 and 6 from the
// style control (Sanity's dropdown; ours: the canvas's / menu, decision 0004), a
// link from the link control (Sanity's toolbar button; ours: the selection
// bubble), and F1 while typing. What each side ends up with goes to the
// annotations; stills + clips go to e2e/evidence/. Not a CI gate (rule 5).
const ID = 'post-10'
// To the end of the line: End does nothing in a macOS contenteditable (Sanity's), Cmd+→ does.
const END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
const shot = (name: string, step: string) => `evidence/J10-${name}-${step}.png`
test.use({video: 'on'})
test.setTimeout(120_000)

const editor = (t: Target, page: Page) => (t.name === 'sanity' ? page.locator('[data-testid="field-body"] [contenteditable="true"]') : page.locator('[id="body"]'))

async function newLine(t: Target, page: Page, body: Locator) {
  // The end of the doc's first paragraph, then a fresh line under it.
  // Sanity's first click activates its editor and the second places the caret; ours
  // places it with the activating click (the canvas mounts under it).
  await body.getByText(/Body paragraph for post 10/).click()
  if (t.name === 'sanity') {
    await page.waitForTimeout(300)
    await body.getByText(/Body paragraph for post 10/).click()
  } else await expect(body.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
  await page.keyboard.press(END)
  await page.keyboard.press('Enter')
}

// The body as it was, put back after (a field patch publishes on ours; Sanity's restore drops the draft).
let original: unknown
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (original !== undefined) await target(info).restore(ID, {body: original})
})

test('@evidence J10: body — shortcuts, marks, styles, link, lists', async ({page, context}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => info.annotations.push({type: what, description: JSON.stringify(v)})
  await Promise.all([t.prepare(context), installProbes(context)])
  original = await t.docValue(ID, 'body')
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Content'}).click()
  const body = editor(t, page)
  await expect(body.getByText(/Body paragraph for post 10/)).toBeVisible({timeout: 20_000})
  await page.waitForTimeout(1500) // both editors settle their layout after the first paint
  await body.scrollIntoViewIfNeeded()

  // Markdown shortcuts.
  await newLine(t, page, body)
  await page.keyboard.type('## Shortcut heading')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- bullet one')
  await page.keyboard.press('Enter')
  await page.keyboard.type('bullet two')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('1. first')
  await page.keyboard.press('Enter')
  await page.keyboard.type('second')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('> a quote line')
  await page.keyboard.press('Enter')
  if (t.name === 'sanity') await page.keyboard.press('Enter') // leave the quote
  // Marks by keyboard, then F1 on plain typing.
  await page.keyboard.type('Plain ')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.type('bold')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.type(' and ')
  await page.keyboard.press('ControlOrMeta+i')
  await page.keyboard.type('italic')
  await page.keyboard.press('ControlOrMeta+i')
  await page.evaluate(() => (window.__feel.keys = []))
  await page.keyboard.type(' then more text', {delay: 60})
  note('F1 frame ms', stats(await page.evaluate(() => window.__feel.keys)))
  await page.screenshot({path: shot(t.name, '1-shortcuts-marks')})

  // Styles from the style control: a level-3 heading, then a level-6 one (H1–H6 both sides).
  for (const [level, text] of [[3, 'Styled heading'], [6, 'Smallest heading']] as const) {
    await page.keyboard.press('Enter')
    if (t.name === 'sanity') {
      await page.keyboard.type(text)
      const style = page.locator('[data-testid="field-body"]').getByRole('button', {name: /No style|Normal|Quote|Heading/}).first()
      await style.click()
      await page.getByRole('menuitem', {name: new RegExp(`Heading ${level}`)}).click()
      // The menu leaves the caret where it likes: back to the end of this line.
      await body.getByText(text, {exact: true}).click()
      await page.keyboard.press(END)
    } else {
      await page.keyboard.type('/')
      await page.locator('.bp-slash-item').filter({hasText: `Heading ${level}`}).click()
      await page.keyboard.type(text)
    }
    await page.waitForTimeout(500)
  }

  // A link from the link control, on the word "Linked".
  await page.keyboard.press('Enter')
  await page.keyboard.type('Linked')
  for (let i = 0; i < 'Linked'.length; i++) await page.keyboard.press('Shift+ArrowLeft')
  if (t.name === 'sanity') {
    // At this width Sanity folds Link into the toolbar's overflow "…".
    const field = page.locator('[data-testid="field-body"]')
    const direct = field.locator('[data-testid="action-button-link"]:not([aria-hidden="true"])')
    if (await direct.count()) await direct.first().click()
    else {
      await field.locator('button:has([data-sanity-icon="ellipsis-horizontal"]):not([aria-label])').first().click()
      await page.waitForTimeout(400)
      await page.locator('[role=menuitem][data-testid="action-button-link"]').click()
    }
    await page.waitForTimeout(800)
    const url = page.locator('[data-testid="popover-edit-dialog"], [role=dialog]').last().locator('input').first()
    await url.fill('https://example.com/j10')
    await page.keyboard.press('Escape')
  } else {
    await page.locator('.bp-paper-format__btn--link').click()
    await page.locator('.bp-paper-format__link-input').fill('https://example.com/j10')
    await page.keyboard.press('Enter')
  }
  await page.waitForTimeout(2500)
  await page.screenshot({path: shot(t.name, '2-style-link')})

  // What landed, read from the editor's own DOM (both draw HTML).
  const got = await body.evaluate((el) => ({
    h2: [...el.querySelectorAll('h2')].map((h) => h.textContent),
    h3: [...el.querySelectorAll('h3')].map((h) => h.textContent),
    h6: [...el.querySelectorAll('h6')].map((h) => h.textContent),
    bullets: [...el.querySelectorAll('ul li')].map((li) => li.textContent),
    numbered: [...el.querySelectorAll('ol li')].map((li) => li.textContent),
    quote: [...el.querySelectorAll('blockquote, .bp-role-pullquote')].map((q) => q.textContent),
    strong: [...el.querySelectorAll('strong, b, [style*="bold"]')].map((s) => s.textContent),
    em: [...el.querySelectorAll('em, i, [style*="italic"]')].map((s) => s.textContent),
    links: [...el.querySelectorAll('a[href]')].map((a) => `${a.textContent} → ${a.getAttribute('href')}`),
  }))
  note('landed', got)
  expect(got.h6, 'a level-6 heading from the style control').toEqual(['Smallest heading'])
  // Ours: and it is saved — the body field's own block list on the server.
  if (t.name === 'studio')
    await expect
      .poll(async () => JSON.stringify(await t.docValue(ID, 'body')), {timeout: 15_000})
      .toMatch(/"text":"Shortcut heading"|"value":"Shortcut heading"[\s\S]*"https:\/\/example\.com\/j10"/)
})
