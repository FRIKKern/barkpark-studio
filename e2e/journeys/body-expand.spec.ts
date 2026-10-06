import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target} from '../rig/targets'

// J35 evidence, both studios, in post-12's body: (1) expand the editor over the
// pane and back — typing before, while and after lands in one run (the caret is
// kept), the pane's scroll is the same after; (2) paste HTML as Docs/Word/a web
// page put it on the clipboard (headings, lists, bold, a link, Word's mso noise) —
// what each side keeps goes to the annotations. Stills + clips in e2e/evidence/.
// Not a CI gate (rule 5).
const ID = 'post-12'
const shot = (name: string, step: string) => `evidence/J35-${name}-${step}.png`
test.use({video: 'on'})
test.setTimeout(150_000)

// What Word puts on the clipboard (trimmed): mso classes and styles around real structure.
const WORD_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>
<h2 class="MsoHeading2">Pasted heading</h2>
<p class="MsoNormal" style="mso-margin-top-alt:auto">A <b style="mso-bidi-font-weight:normal">bold</b> word and <a href="https://example.com/pasted">a link</a>.</p>
<ul><li class="MsoListParagraph">pasted one</li><li class="MsoListParagraph">pasted two</li></ul>
<o:p></o:p></body></html>`

let original: unknown
test.afterEach(async ({}, info) => {
  if (original !== undefined) await target(info).restore(ID, {body: original})
})

const bodyOf = (t: Target, page: Page) => (t.name === 'sanity' ? page.locator('[data-testid="field-body"]') : page.locator('[id="body"]'))
const scroller = (t: Target, page: Page) =>
  page.evaluate((sanity) => {
    // The scrolling element around the body field.
    let el = document.querySelector(sanity ? '[data-testid="field-body"]' : '[id="body"]')?.parentElement ?? null
    while (el && !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible')) el = el.parentElement
    return el ? Math.round(el.scrollTop) : -1
  }, t.name === 'sanity')

test('@evidence J35: expand and back keeps the caret; paste keeps structure', async ({page}, info) => {
  const t = target(info)
  const note = (what: string, v: unknown) => info.annotations.push({type: what, description: JSON.stringify(v)})
  original = await t.docValue(ID, 'body')
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Content'}).click()
  const body = bodyOf(t, page)
  const para = body.getByText(/Body paragraph for post 12/)
  await expect(para).toBeVisible({timeout: 20_000})
  await page.waitForTimeout(1000)
  await para.click()
  if (t.name === 'sanity') (await page.waitForTimeout(300), await para.click())
  else await expect(body.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
  await page.keyboard.press('End')
  await page.keyboard.type(' before')
  const scrollBefore = await scroller(t, page)

  // Expand, type, back, type.
  await page.getByRole('button', {name: 'Expand editor'}).first().click()
  await page.waitForTimeout(800)
  await page.keyboard.type(' during')
  await page.screenshot({path: shot(t.name, '1-expanded')})
  const collapse = page.getByRole('button', {name: /Collapse editor/}).first()
  if (await collapse.count()) await collapse.click()
  else await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  await page.keyboard.type(' after')
  await page.screenshot({path: shot(t.name, '2-back')})
  const run = 'Body paragraph for post 12. before during after'
  const together = await body.getByText(run).isVisible().catch(() => false)
  note('caret kept', together ? 'typing before, during and after expanding lands in one run' : 'the run was split (see the still)')
  if (t.name === 'studio') expect(together, 'caret kept across expand').toBe(true)
  note('scroll before/after', [scrollBefore, await scroller(t, page)])

  // Paste Word-flavoured HTML on a fresh line.
  await page.keyboard.press('Enter')
  await page.evaluate((html) => {
    const d = new DataTransfer()
    d.setData('text/html', html)
    d.setData('text/plain', 'Pasted heading\nA bold word and a link.\npasted one\npasted two')
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', {clipboardData: d, bubbles: true, cancelable: true}))
  }, WORD_HTML)
  await page.waitForTimeout(2500)
  await page.screenshot({path: shot(t.name, '3-pasted')})
  const kept = await body.evaluate((el) => ({
    heading: [...el.querySelectorAll('h1, h2, h3')].map((h) => h.textContent).filter((x) => x?.includes('Pasted')),
    listItems: [...el.querySelectorAll('li, [data-list-item], [class*="listItem"]')].map((li) => li.textContent?.trim()).filter((x) => x?.startsWith('pasted')),
    bold: [...el.querySelectorAll('strong, b')].map((b) => b.textContent).filter((x) => x === 'bold'),
    link: [...el.querySelectorAll('a[href*="example.com/pasted"]')].map((a) => a.textContent),
    msoLeft: /Mso|mso-/.test(el.innerHTML),
  }))
  note('paste kept', kept)
  if (t.name === 'studio') {
    expect(kept.heading.length, 'heading kept').toBeGreaterThan(0)
    expect(kept.listItems, 'list kept').toEqual(['pasted one', 'pasted two'])
    expect(kept.bold, 'bold kept').toEqual(['bold'])
    expect(kept.link, 'link kept').toEqual(['a link'])
    expect(kept.msoLeft, 'no Word noise').toBe(false)
  }
})
