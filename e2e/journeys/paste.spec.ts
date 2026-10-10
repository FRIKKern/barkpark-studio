import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target, closeAndSettle} from '../rig/targets'

// Paste fidelity, both studios: the same clipboard (text/html + text/plain, as the source
// app puts it there) pasted on a fresh line in a post's body. What each stores goes to the
// annotations; stills to e2e/evidence/. The clipboards are the sources' own shapes: Google
// Docs' <b style="font-weight:normal"> wrapper and styled spans, Word's MsoNormal paragraphs
// and mso-list "lists", a web article (figure, table, pre), Markdown and plain text.
// Not a CI gate: evidence for the paste journey (B15).
const ID = 'post-paste'
const END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
test.setTimeout(120_000)
test.use({video: 'off'})

const S = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;'
const P = 'line-height:1.38;margin-top:0pt;margin-bottom:0pt;'
export const CLIPBOARDS: Record<string, {html?: string; text: string}> = {
  'google-docs': {
    html: `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-7fff-1234-5678-9abcdef01234"><h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;"><span style="font-size:16pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;font-style:normal;${S}">Docs heading</span></h2><p dir="ltr" style="${P}"><span style="${S}font-weight:700;font-style:normal;">Bold</span><span style="${S}font-weight:400;font-style:normal;">, </span><span style="${S}font-weight:400;font-style:italic;">italic</span><span style="${S}font-weight:400;font-style:normal;"> and a </span><a href="https://example.com/docs" style="text-decoration:none;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#1155cc;font-weight:400;font-style:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">link</span></a><span style="${S}font-weight:400;">.</span></p><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;" aria-level="1"><p dir="ltr" style="${P}" role="presentation"><span style="${S}font-weight:400;">Docs bullet one</span></p></li><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" style="${P}" role="presentation"><span style="${S}font-weight:400;">Docs bullet two</span></p></li></ul><br><p dir="ltr" style="${P}"><span style="${S}font-weight:400;">Docs last line</span></p></b><br class="Apple-interchange-newline">`,
    text: 'Docs heading\nBold, italic and a link.\n* Docs bullet one\n* Docs bullet two\n\nDocs last line',
  },
  word: {
    html: `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=Generator content="Microsoft Word 15"><style><!-- p.MsoNormal {margin:0in;font-size:11.0pt;font-family:"Calibri",sans-serif;} p.MsoListParagraphCxSpFirst {margin-left:.5in;} --></style></head><body lang=EN-US style='tab-interval:.5in'><!--StartFragment--><h1><span style='mso-fareast-font-family:"Times New Roman"'>Word heading<o:p></o:p></span></h1><p class=MsoNormal><b><span style='font-family:"Calibri",sans-serif'>Bold</span></b>, <i>italic</i> and a <a href="https://example.com/word">link</a>.<o:p></o:p></p><p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Word bullet one<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Word bullet two<o:p></o:p></p><p class=MsoNormal>Word last line<o:p></o:p></p><!--EndFragment--></body></html>`,
    text: 'Word heading\nBold, italic and a link.\n·        Word bullet one\n·        Word bullet two\nWord last line',
  },
  'web-article': {
    html: `<meta charset="utf-8"><article><h2>Web heading</h2><p><strong>Bold</strong> and <em>italic</em> with a <a href="https://example.com/web" target="_blank" rel="noopener" class="ext">link</a>.</p><ul><li>Web bullet one</li><li>Web bullet <strong>two</strong></li></ul><ol><li>Web number one</li></ol><figure><img src="https://www.sanity.io/static/images/opengraph/social.png" alt="A photo" width="20" height="20"><figcaption>A caption</figcaption></figure><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><blockquote><p>Quoted text</p></blockquote><pre><code>const x = 1</code></pre><p>Web last line</p></article>`,
    text: 'Web heading\nBold and italic with a link.\nWeb bullet one\nWeb bullet two\nWeb number one\nA caption\nA\tB\n1\t2\nQuoted text\nconst x = 1\nWeb last line',
  },
  markdown: {text: '## MD heading\n\n**Bold** and *italic* with a [link](https://example.com/md).\n\n- MD bullet one\n- MD bullet two\n\n1. MD one\n2. MD two\n\n> MD quote\n\nMD last line'},
  'plain-text': {text: 'Line one\nLine two\n\nNew paragraph after a blank line'},
}

const editor = (t: Target, page: Page) => (t.name === 'sanity' ? page.locator('[data-testid="field-body"] [contenteditable="true"]') : page.locator('[id="body"]'))
const seedBody = (t: Target) =>
  t.name === 'sanity'
    ? [{_type: 'block', _key: 'p0', style: 'normal', markDefs: [], children: [{_type: 'span', _key: 's0', text: 'Paste below this line.', marks: []}]}]
    : {blocks: [{id: 'p0', type: 'paragraph', content: [{type: 'text', value: 'Paste below this line.'}]}]}

test.afterEach(async ({page}, info) => (await closeAndSettle(page), await target(info).deleteDoc(ID, 'post')))

for (const [source, clip] of Object.entries(CLIPBOARDS))
  test(`@evidence paste from ${source}`, async ({page, context}, info) => {
    const t = target(info)
    await t.draftOnly(ID, 'post', {title: `Paste ${source}`, body: seedBody(t)})
    await t.prepare(context)
    await page.goto(t.docPath('post', ID))
    await signInIfAsked(page)
    await t.settle(page)
    await page.getByRole('tab', {name: 'Content'}).click().catch(() => {})
    const body = editor(t, page)
    const line = body.getByText('Paste below this line.')
    await expect(line).toBeVisible({timeout: 20_000})
    await line.click()
    if (t.name === 'sanity') (await page.waitForTimeout(300), await line.click())
    else await expect(body.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
    await page.keyboard.press(END)
    await page.keyboard.press('Enter')
    // The source app's clipboard, as a real paste event carries it (no clipboard sanitizer).
    await page.evaluate((c) => {
      const dt = new DataTransfer()
      if (c.html) dt.setData('text/html', c.html)
      dt.setData('text/plain', c.text)
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}))
    }, clip)
    await page.waitForTimeout(t.name === 'sanity' ? 4000 : 3000)
    const stored = await t.docValue(ID, 'body')
    info.annotations.push({type: `${source} stored`, description: JSON.stringify(stored)})
    await body.screenshot({path: `evidence/paste-${t.name}-${source}.png`})
  })
