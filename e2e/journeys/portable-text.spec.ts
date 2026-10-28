import {readFileSync} from 'node:fs'
import {expect, test} from '../rig/test'
import {bpBase, bpDataset, bpMutate, closeAndSettle, savesLanded, target} from '../rig/targets'

// S4a (task-7f77f41c95cc6d9f): a rich text field holding Portable Text edits in place
// with @portabletext/editor. Opening and closing it writes nothing; one word edited
// changes that span only, every _key kept; custom blocks, inline objects, unknown marks
// and markDefs come back byte for byte; discarding the draft leaves the published doc
// as it was. Made-up content (the repo is public).
const ID = `post-pt-${Date.now().toString(36)}`
const BODY = [
  {_key: 'p1', _type: 'block', style: 'normal', markDefs: [], children: [{_key: 'p1s1', _type: 'span', marks: [], text: 'Brew the tea with warm water.'}]},
  {
    _key: 'p2',
    _type: 'block',
    style: 'normal',
    markDefs: [{_key: 'lk1', _type: 'internalLink', reference: {_ref: 'page-kettle', _type: 'reference'}, extra: {deep: [1, 2]}}],
    children: [
      {_key: 'p2s1', _type: 'span', marks: ['strong'], text: 'Steep it for '},
      {_key: 'p2s2', _type: 'span', marks: ['lk1', 'glowMark'], text: 'three minutes'},
      {_key: 'p2i1', _type: 'teaChip', label: 'Green', tint: 4},
      {_key: 'p2s3', _type: 'span', marks: [], text: ' at most.'},
    ],
  },
  {_key: 'c1', _type: 'kettleCallout', tone: 'warm', nested: {list: [1, 2, {deep: 'yes'}]}},
  {_key: 'p3', _type: 'block', style: 'h2', markDefs: [], children: [{_key: 'p3s1', _type: 'span', marks: [], text: 'Cups'}]},
  {_key: 'p4', _type: 'block', style: 'normal', listItem: 'bullet', level: 1, markDefs: [], children: [{_key: 'p4s1', _type: 'span', marks: ['em'], text: 'Pour slowly'}]},
  // S4b: a declared annotation with no declared fields; the dialog reads them off this markDef.
  {
    _key: 'p5',
    _type: 'block',
    style: 'normal',
    markDefs: [{_key: 'wk1', _type: 'wikilink', author: {_ref: 'author-ada', _type: 'reference'}, shelf: {row: 2}}],
    children: [
      {_key: 'p5s1', _type: 'span', marks: [], text: 'Ask '},
      {_key: 'p5s2', _type: 'span', marks: ['wk1'], text: 'the tea maker'},
    ],
  },
]

type Doc = {_rev: string; _updatedAt?: string; body?: unknown}
const read = async (perspective: 'drafts' | 'published'): Promise<Doc | undefined> => {
  const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/post/${ID}?perspective=${perspective}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  return r.ok ? ((await r.json()) as {result: Doc}).result : undefined
}

test.setTimeout(45_000)
test.beforeEach(async ({}, info) => {
  test.skip(target(info).name === 'sanity', 'ours: Sanity has its own Portable Text input')
  await bpMutate([{createOrReplace: {_id: ID, _type: 'post', title: 'Tea notes', body: BODY}}, {publish: {id: ID, type: 'post'}}])
})
test.afterEach(async ({page}) => (await closeAndSettle(page), await bpMutate([{delete: {id: ID, type: 'post', force: true}}]).catch(() => {})))

async function open(page: import('@playwright/test').Page, info: import('@playwright/test').TestInfo) {
  const t = target(info)
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'All fields'}).click()
  const editor = page.locator('[id="body"][contenteditable="true"]')
  await expect(editor).toContainText('Brew the tea with warm water.')
  // The editor has read the value (its 'ready'): a click before that places no caret.
  await field(page).and(page.locator('[data-ready]')).waitFor()
  return editor
}

/** A named insert button, or its Show more item where the bar folds it away (as Sanity's does). */
async function insert(page: import('@playwright/test').Page, title: string, kind: 'block' | 'inline') {
  const button = field(page).getByRole('button', {name: `Insert ${title} (${kind})`})
  if (await button.isVisible()) return button.click()
  await field(page).getByRole('button', {name: 'Show more'}).click()
  await page.getByRole('menuitem', {name: title, exact: true}).click()
}

/**
 * "warm" selected by a double click, as a person does. The editor focused first and seen to
 * have read the caret (the style button names its block's style): a double click as the
 * editor first takes focus could be split by that render and select nothing (CI flaked once).
 */
async function selectWarm(page: import('@playwright/test').Page, editor: import('@playwright/test').Locator) {
  const text = editor.getByText('Brew the tea with warm water.')
  await text.click({position: {x: 135, y: 8}})
  await expect(field(page).locator('.body-style')).toHaveText('Normal')
  await text.dblclick({position: {x: 135, y: 8}})
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toBe('warm')
}

/** The body's input: its toolbar, not another Portable Text field's (ptBody is one too). */
const field = (page: import('@playwright/test').Page) => page.locator('.pt-input').filter({has: page.locator('[id="body"][contenteditable="true"]')})

test('Portable Text: opening, clicking in and closing writes nothing', async ({page}, info) => {
  const before = await read('drafts')
  const editor = await open(page, info)
  await editor.getByText('Cups').click()
  await page.waitForTimeout(1500)
  await savesLanded(page)
  await page.close()
  const after = await read('drafts')
  expect(after?._rev).toBe(before?._rev)
  expect(JSON.stringify(after?.body)).toBe(JSON.stringify(before?.body))
})

test('Portable Text: one word edited changes that span only, keys and unknown content kept, discard leaves published as it was', async ({page}, info) => {
  const published = await read('published')
  const stored = JSON.parse(JSON.stringify(published!.body)) as typeof BODY
  const editor = await open(page, info)
  await selectWarm(page, editor)
  await page.keyboard.type('hot')
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('Brew the tea with hot water.')
  const draft = (await read('drafts'))!.body as typeof BODY
  // Only that span's text differs; every block and span keeps its key.
  const expected = JSON.parse(JSON.stringify(stored)) as typeof BODY
  expected[0].children[0].text = 'Brew the tea with hot water.'
  expect(draft).toEqual(expected)
  // Custom block, inline object, unknown mark and markDef: byte for byte as stored.
  for (const i of [1, 2, 3, 4]) expect(JSON.stringify(draft[i])).toBe(JSON.stringify(stored[i]))
  // Discard the draft: the published doc is untouched.
  await bpMutate([{discardDraft: {id: ID, type: 'post'}}])
  const after = await read('published')
  expect(after?._rev).toBe(published?._rev)
  expect(JSON.stringify(after?.body)).toBe(JSON.stringify(published?.body))
})

// task-0b78ed09edd97e6f: after Discard changes the editor kept the discarded words on screen
// while the stored value was the published one; the next key would have written them back.
test('Portable Text: Discard changes puts the published text back in the editor', async ({page}, info) => {
  const t = target(info)
  const editor = await open(page, info)
  await selectWarm(page, editor)
  await page.keyboard.type('hot')
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('Brew the tea with hot water.')
  await t.docMenu(page).click()
  await page.getByRole('menuitem', {name: /Discard changes/}).click()
  const discard = page.getByRole('dialog').getByRole('button', {name: /^Discard changes$/})
  await discard.click()
  await expect(editor).toContainText('Brew the tea with warm water.')
  await expect(editor).not.toContainText('hot water')
})

test('@local Portable Text: styles, lists and decorators edit from the toolbar', async ({page}, info) => {
  const editor = await open(page, info)
  // Each toolbar step waits for the editor to show it has read the click's selection (the
  // style it names, a list pressed, a range that Link can take), never for a set time: a
  // click before the editor read the selection acted on the old one (the step flaked).
  await editor.getByText('Cups').click()
  await expect(field(page).locator('.body-style')).toHaveText('Heading 2')
  // The style button (Sanity's menu, each style drawn as it looks).
  await field(page).locator('.body-style').click()
  await page.getByRole('menuitemradio', {name: 'Heading 3'}).click()
  await editor.getByText('Pour slowly').click()
  const bullets = field(page).getByRole('button', {name: 'Bulleted list'})
  await expect(bullets).toHaveAttribute('aria-pressed', 'true')
  await bullets.click()
  await editor.getByText('Brew the tea with warm water.').dblclick({position: {x: 10, y: 8}})
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toBe('Brew')
  await expect(field(page).getByRole('button', {name: 'Link', exact: true})).toBeEnabled()
  await field(page).getByRole('button', {name: 'Strong'}).click()
  await savesLanded(page)
  await expect
    .poll(async () => {
      const body = ((await read('drafts'))?.body ?? []) as typeof BODY
      return [body[3]?.style, body[4]?.listItem ?? null, body[0]?.children.find((c) => c.text === 'Brew')?.marks]
    }, {timeout: 10_000})
    .toEqual(['h3', null, ['strong']])
})

// S4b (annotations): a link added from the toolbar is a markDef with a 12-hex key and its
// span marked; a reference annotation's target edits in the reference input and changes
// that markDef only; Remove takes the annotation off its text.
test('@local Portable Text: add a link, change a reference annotation\'s target, remove it; only those markDefs change', async ({page}, info) => {
  test.setTimeout(90_000)
  const stored = ((await read('published'))!.body ?? []) as typeof BODY
  const editor = await open(page, info)
  // Add: select a word, the Link button, its URL, close.
  await selectWarm(page, editor)
  await field(page).getByRole('button', {name: 'Link', exact: true}).click()
  const link = page.getByRole('dialog', {name: 'Link'})
  await link.locator('[id="body.link.href"]').fill('https://example.com/kettles')
  await link.getByRole('button', {name: 'Close dialog'}).click()
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('https://example.com/kettles')
  let draft = (await read('drafts'))!.body as typeof BODY
  const added = (draft[0].markDefs as {_key: string; _type: string; href?: string}[])[0]
  expect(added).toEqual({_key: expect.stringMatching(/^[0-9a-f]{12}$/), _type: 'link', href: 'https://example.com/kettles'})
  expect(draft[0].children.find((c) => c.text === 'warm')?.marks).toEqual([added._key])
  for (const i of [1, 2, 3, 4, 5]) expect(JSON.stringify(draft[i])).toBe(JSON.stringify(stored[i]))

  // Edit: the caret in the wikilink, its target replaced in the reference input.
  await editor.getByText('the tea maker').click()
  await page.waitForTimeout(150)
  await field(page).getByRole('button', {name: 'Edit Wikilink'}).click()
  const wiki = page.getByRole('dialog', {name: 'Wikilink'})
  await wiki.getByRole('button', {name: 'Reference actions'}).click()
  await page.getByRole('menuitem', {name: 'Replace'}).click()
  await wiki.locator('[id="body.wikilink.author"]').fill('Grace')
  await page.getByRole('option').filter({hasText: 'Grace Hopper'}).first().click()
  await wiki.getByRole('button', {name: 'Close dialog'}).click()
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('author-grace')
  const before = draft
  draft = (await read('drafts'))!.body as typeof BODY
  expect(draft[5].markDefs).toEqual([{_key: 'wk1', _type: 'wikilink', author: {_ref: 'author-grace', _type: 'reference'}, shelf: {row: 2}}])
  expect(JSON.stringify(draft[5].children)).toBe(JSON.stringify(before[5].children))
  for (const i of [0, 1, 2, 3, 4]) expect(JSON.stringify(draft[i])).toBe(JSON.stringify(before[i]))

  // Remove: the annotation comes off its text.
  await editor.getByText('the tea maker').click()
  await page.waitForTimeout(150)
  await field(page).getByRole('button', {name: 'Edit Wikilink'}).click()
  await page.getByRole('dialog', {name: 'Wikilink'}).getByRole('button', {name: 'Remove Wikilink'}).click()
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify(((await read('drafts'))?.body as typeof BODY)[5].children), {timeout: 10_000}).not.toContain('wk1')
})

// S4c (custom blocks and inline objects): Insert adds a declared custom block or inline
// object with its _type and a 12-hex _key, filled in from its dialog; Edit on a stored one
// changes the fields edited and nothing else.
test('@local Portable Text: insert a custom block and an inline object, edit stored ones; only those change', async ({page}, info) => {
  test.setTimeout(90_000)
  const stored = ((await read('published'))!.body ?? []) as typeof BODY
  const editor = await open(page, info)
  type Item = Record<string, unknown> & {_key: string; _type: string}
  const body = async () => ((await read('drafts'))?.body ?? []) as (Item & {children?: Item[]})[]

  // A callout after "Cups", its tone and text set in the dialog.
  await editor.getByText('Cups').click()
  await page.waitForTimeout(150)
  // Sanity's named insert buttons (at 1440 both fit; a narrow bar folds them behind Show more).
  await insert(page, 'Callout', 'block')
  const callout = page.getByRole('dialog', {name: 'Callout'})
  await callout.locator('[id="body.callout.tone"]').selectOption({label: 'Warning'})
  await callout.locator('[id="body.callout.text"]').fill('Mind the steam')
  await callout.getByRole('button', {name: 'Close dialog'}).click()
  await savesLanded(page)
  // The block lands first, its dialog's fields a save later.
  await expect.poll(async () => (await body()).find((b) => b._type === 'callout')?.tone, {timeout: 10_000}).toBe('warning')
  let draft = await body()
  expect(draft[4]).toEqual({_key: expect.stringMatching(/^[0-9a-f]{12}$/), _type: 'callout', tone: 'warning', text: 'Mind the steam'})
  expect(JSON.stringify(draft.filter((b) => b._type !== 'callout'))).toBe(JSON.stringify(stored))

  // A chip at the caret in "Pour slowly".
  await editor.getByText('Pour slowly').click()
  await page.waitForTimeout(150)
  await insert(page, 'Chip', 'inline')
  const chip = page.getByRole('dialog', {name: 'Chip'})
  await chip.locator('[id="body.chip.text"]').fill('Hot')
  await chip.getByRole('button', {name: 'Close dialog'}).click()
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await body()).find((b) => b._key === 'p4')?.children), {timeout: 10_000}).toContain('"chip"')
  let before = draft
  draft = await body()
  const p4 = draft.find((b) => b._key === 'p4')!
  expect(p4.children!.find((c) => c._type === 'chip')).toEqual({_key: expect.stringMatching(/^[0-9a-f]{12}$/), _type: 'chip', text: 'Hot'})
  for (const b of draft) if (b._key !== 'p4') expect(JSON.stringify(b)).toBe(JSON.stringify(before.find((x) => x._key === b._key)))

  // The stored custom block: its tone edited, its nested field kept.
  await editor.locator('.pt-object[data-type="kettleCallout"]').getByRole('button', {name: 'Open menu'}).click()
  await page.getByRole('menuitem', {name: 'Edit'}).click()
  const kettle = page.getByRole('dialog', {name: 'Kettle Callout'})
  await kettle.locator('[id="body.kettleCallout.tone"]').fill('cold')
  await kettle.getByRole('button', {name: 'Close dialog'}).click()
  await savesLanded(page)
  await expect.poll(async () => (await body()).find((b) => b._key === 'c1')?.tone, {timeout: 10_000}).toBe('cold')
  before = draft
  draft = await body()
  expect(JSON.stringify(draft.find((b) => b._key === 'c1'))).toBe(JSON.stringify({...stored[2], tone: 'cold'}))
  for (const b of draft) if (b._key !== 'c1') expect(JSON.stringify(b)).toBe(JSON.stringify(before.find((x) => x._key === b._key)))

  // The stored inline object: its label edited from its chip, its tint kept.
  await editor.locator('.pt-inline-object[data-type="teaChip"] [role="button"]').click()
  const tea = page.getByRole('dialog', {name: 'Tea Chip'})
  await tea.locator('[id="body.teaChip.label"]').fill('Black')
  await tea.getByRole('button', {name: 'Close dialog'}).click()
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await body()).find((b) => b._key === 'p2')?.children), {timeout: 10_000}).toContain('Black')
  before = draft
  draft = await body()
  const p2 = draft.find((b) => b._key === 'p2')!
  expect(p2.children![2]).toEqual({_key: 'p2i1', _type: 'teaChip', label: 'Black', tint: 4})
  expect(JSON.stringify(p2.markDefs)).toBe(JSON.stringify(stored[1].markDefs))
  for (const b of draft) if (b._key !== 'p2') expect(JSON.stringify(b)).toBe(JSON.stringify(before.find((x) => x._key === b._key)))
})

// Sanity's default editor plugins (task-a375ab49a1e5ffff, task-03219d1c3ae221d7,
// task-c50f184c65e0132e): Markdown shortcuts, smart typography and a URL pasted over text.
test('@local Portable Text: Markdown shortcuts, smart typography and a pasted URL store as Sanity\'s', async ({page}, info) => {
  const editor = await open(page, info)
  // The caret at the end of a text, or a word selected, as the browser's selection.
  const select = (text: string, word?: string) =>
    editor.evaluate(
      (el, [text, word]) => {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
          if (!n.data.includes(text)) continue
          const r = document.createRange()
          const at = word ? n.data.indexOf(word) : n.data.length
          r.setStart(n, at)
          r.setEnd(n, word ? at + word.length : at)
          getSelection()!.removeAllRanges()
          getSelection()!.addRange(r)
          return
        }
      },
      [text, word] as const,
    )
  await editor.getByText('Brew the tea with warm water.').click()
  await select('Brew the tea with warm water.')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.keyboard.type('## Kettles')
  await page.keyboard.press('Enter')
  await page.keyboard.type('**Hot** "tea" -- now')
  await select('Brew the tea with warm water.', 'water')
  await page.waitForTimeout(150)
  await editor.evaluate((el) => {
    const data = new DataTransfer()
    data.setData('text/plain', 'https://example.com/kettles')
    el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}))
  })
  await savesLanded(page)
  type Block = {style?: string; markDefs?: {_key: string; _type: string; href?: string}[]; children: {text: string; marks?: string[]}[]}
  await expect
    .poll(async () => {
      const body = ((await read('drafts'))?.body ?? []) as Block[]
      const link = body[0]?.markDefs?.find((d) => d._type === 'link')
      return [
        body[1]?.style,
        body[1]?.children?.map((c) => c.text).join(''),
        body[2]?.children?.map((c) => [c.text, c.marks ?? []]),
        link?.href,
        body[0]?.children?.find((c) => c.text === 'water')?.marks?.includes(link?._key ?? '-'),
      ]
    }, {timeout: 10_000})
    .toEqual(['h2', 'Kettles', [['Hot', ['strong']], [' “tea” — now', []]], 'https://example.com/kettles', true])
})

// task-f625cf11a0810ca2: Sanity's popover over an annotation, with its title, Edit and Remove.
test('@local Portable Text: the popover over an annotation opens its dialog and removes it', async ({page}, info) => {
  const editor = await open(page, info)
  const pop = page.locator('.pt-annotation-pop')
  await editor.getByText('the tea maker').click()
  await expect(pop).toHaveText('Wikilink')
  await pop.getByRole('button', {name: 'Edit annotation'}).click()
  const wiki = page.getByRole('dialog', {name: 'Wikilink'})
  await expect(wiki).toBeVisible()
  await wiki.getByRole('button', {name: 'Close dialog'}).click()
  await editor.getByText('the tea maker').click()
  await pop.getByRole('button', {name: 'Remove annotation'}).click()
  await expect(pop).toBeHidden()
  await savesLanded(page)
  type Block = {markDefs?: unknown[]; children: {text: string; marks?: string[]}[]}
  await expect
    .poll(async () => {
      const b = ((await read('drafts'))?.body ?? []) as Block[]
      return [b[5]?.markDefs, b[5]?.children?.map((c) => c.text).join(''), b[5]?.children?.some((c) => c.marks?.length)]
    }, {timeout: 10_000})
    .toEqual([[], 'Ask the tea maker', false])
})

// task-9a2e53f73e6461e7: expand over the document pane and back, as Sanity's (and the
// canvas body's, J35); the editor stays mounted, so the caret and typing carry on.
test('@local Portable Text: Expand editor and back keeps the caret; Cmd/Ctrl+Enter and Escape toggle it', async ({page}, info) => {
  const editor = await open(page, info)
  const box = field(page)
  await editor.getByText('Cups').click()
  // The caret at the end of "Cups" before expanding (End scrolls on a Mac): typing after lands there.
  await editor.evaluate((el) => {
    const text = [...el.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent === 'Cups')!.firstChild!
    getSelection()!.collapse(text, 4)
  })
  await page.waitForTimeout(150)
  await box.getByRole('button', {name: 'Expand editor'}).click()
  await expect(box).toHaveAttribute('data-expanded')
  // Flush over the pane body.
  const [pane, area] = await Promise.all([page.locator('.pane-body').last().boundingBox(), box.boundingBox()])
  expect([Math.round(area!.x), Math.round(area!.width)]).toEqual([Math.round(pane!.x), Math.round(pane!.width)])
  await page.keyboard.type(' and saucers')
  await page.keyboard.press('Escape')
  await expect(box).not.toHaveAttribute('data-expanded')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(box).toHaveAttribute('data-expanded')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(box).not.toHaveAttribute('data-expanded')
  await expect(editor).toBeFocused()
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('Cups and saucers')
})

// task-2a1286a4e3d569de: a custom block's … menu, as Sanity's: Edit and Remove.
test('@local Portable Text: a custom block\'s menu removes it; every other block stays as stored', async ({page}, info) => {
  const stored = ((await read('published'))!.body ?? []) as typeof BODY
  const editor = await open(page, info)
  await editor.locator('.pt-object[data-type="kettleCallout"]').getByRole('button', {name: 'Open menu'}).click()
  await expect(page.getByRole('menuitem')).toHaveText(['Edit', 'Remove'])
  await page.getByRole('menuitem', {name: 'Remove'}).click()
  await expect(editor.locator('.pt-object[data-type="kettleCallout"]')).toHaveCount(0)
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).not.toContain('kettleCallout')
  const draft = (await read('drafts'))!.body as typeof BODY
  expect(JSON.stringify(draft)).toBe(JSON.stringify(stored.filter((b) => b._key !== 'c1')))
})

// task-65c50f82aed32ea8: an image block inserts as Sanity's, its image picked in the image input.
test('@local Portable Text: Insert Image puts an image block in, its image picked from the library', async ({page}, info) => {
  const stored = ((await read('published'))!.body ?? []) as typeof BODY
  const editor = await open(page, info)
  await editor.getByText('Cups').click()
  await page.waitForTimeout(150)
  await insert(page, 'Image', 'block')
  const dialog = page.getByRole('dialog', {name: 'Image'})
  await dialog.getByRole('button', {name: 'Select'}).click()
  // The library's first image (whichever it is): its tile's button.
  const picked = page.getByRole('dialog').last().getByRole('button', {name: /\.(png|jpe?g|webp|gif)$/i}).first()
  await picked.click()
  await dialog.getByRole('button', {name: 'Close dialog'}).click()
  await expect(editor.locator('.pt-object[data-type="image"] .pt-image-view img')).toBeVisible()
  await savesLanded(page)
  type Img = {_key: string; _type: string; asset?: {_type: string; _ref: string}}
  // The block lands first, its image a save later.
  await expect.poll(async () => ((await read('drafts'))?.body as unknown as Img[] | undefined)?.find((b) => b._type === 'image')?.asset?._ref, {timeout: 10_000}).toBeTruthy()
  const draft = (await read('drafts'))!.body as unknown as Img[]
  const image = draft.find((b) => b._type === 'image')!
  expect(image).toEqual({_key: expect.stringMatching(/^[0-9a-f]{12}$/), _type: 'image', asset: {_type: 'reference', _ref: expect.any(String)}})
  // After "Cups"; every other block as stored.
  expect(draft[draft.indexOf(image) - 1]._key).toBe('p3')
  expect(JSON.stringify(draft.filter((b) => b !== image))).toBe(JSON.stringify(stored))
})

// task-764545042192c57d: the toolbar is one Tab stop, the arrows move between its tools (Sanity's).
test('@local Portable Text: the toolbar is one Tab stop; arrows, Home and End move between tools', async ({page}, info) => {
  const editor = await open(page, info)
  await editor.getByText('Cups').click()
  await expect(field(page).locator('.body-style')).toHaveText('Heading 2')
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || (document.activeElement as HTMLElement | null)?.innerText)
  // Back from the text: the toolbar's one stop, its first tool.
  await page.keyboard.press('Shift+Tab')
  await expect.poll(focused).toBe('Heading 2')
  await page.keyboard.press('ArrowRight')
  await expect.poll(focused).toBe('Strong')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(focused).not.toBe('Heading 2') // wrapped round to the last tool
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect.poll(focused).toBe('Strong')
  // Out of the toolbar in one Shift+Tab, and back in on the tool last used.
  await page.keyboard.press('Shift+Tab')
  await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('.pt-toolbar'))).toBe(false)
  await page.keyboard.press('Tab')
  await expect.poll(focused).toBe('Strong')
})

// task-e76b738c90624a72: a custom block's card drags to another place, as Sanity's does.
test('@local Portable Text: a custom block card dropped in place writes nothing; below the next block, only the order changes', async ({page}, info) => {
  const stored = ((await read('published'))!.body ?? []) as typeof BODY
  const editor = await open(page, info)
  const cups = editor.getByText('Cups', {exact: true})
  const box = (await cups.boundingBox())!
  const card = editor.locator('.pt-object[data-type="kettleCallout"] .pt-object-head')
  // Onto the upper half of "Cups", the block after it: where it already is. Nothing is written.
  const published = await read('published')
  await card.dragTo(cups, {targetPosition: {x: 5, y: 4}})
  await page.waitForTimeout(1500)
  await savesLanded(page)
  expect((await read('drafts'))?._rev).toBe(published?._rev)
  // Onto the lower half of "Cups": the card goes after it.
  await card.dragTo(cups, {targetPosition: {x: 5, y: box.height - 4}})
  await savesLanded(page)
  const order = async () => (((await read('drafts'))?.body ?? []) as typeof BODY).map((b) => b._key)
  await expect.poll(order, {timeout: 10_000}).toEqual(['p1', 'p2', 'p3', 'c1', 'p4', 'p5'])
  const draft = ((await read('drafts'))!.body ?? []) as typeof BODY
  for (const b of stored) expect(JSON.stringify(draft.find((x) => x._key === b._key))).toBe(JSON.stringify(b))
})

// task-9514965bfed38750: an image file pasted into the text comes in as an image block (Sanity's).
// The fixture image's bytes are already in the library: no upload, the same asset back.
test('@local Portable Text: a pasted image file becomes an image block after the caret\'s block; a failed upload adds nothing', async ({page}, info) => {
  const stored = ((await read('published'))!.body ?? []) as typeof BODY
  const editor = await open(page, info)
  const png = readFileSync(new URL('../../fixtures/assets/fixture-image.png', import.meta.url)).toString('base64')
  const paste = () =>
    editor.evaluate((el, b64) => {
      const data = new DataTransfer()
      data.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'kettle.png', {type: 'image/png'}))
      el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}))
    }, png)
  await editor.getByText('Cups').click()
  await expect(field(page).locator('.body-style')).toHaveText('Heading 2')
  // A failed upload first: it says so and puts nothing in.
  await page.route(/\/api\/media\/by-sha1/, (route) => route.fulfill({status: 404, body: '{}'}))
  await page.route(/\/api\/media\/upload/, (route) => route.abort())
  await paste()
  await expect(page.getByText('Upload failed').first()).toBeVisible()
  await expect(editor.locator('.pt-object[data-type="image"]')).toHaveCount(0)
  await page.unrouteAll()
  await paste()
  await expect(editor.locator('.pt-object[data-type="image"] .pt-image-view img')).toBeVisible()
  await savesLanded(page)
  type Img = {_key: string; _type: string; asset?: {_type: string; _ref: string}}
  await expect.poll(async () => ((await read('drafts'))?.body as unknown as Img[] | undefined)?.find((b) => b._type === 'image')?.asset?._ref, {timeout: 10_000}).toBeTruthy()
  const draft = (await read('drafts'))!.body as unknown as Img[]
  const image = draft.find((b) => b._type === 'image')!
  expect(image).toEqual({_key: expect.stringMatching(/^[0-9a-f]{12}$/), _type: 'image', asset: {_type: 'reference', _ref: expect.any(String)}})
  expect(draft[draft.indexOf(image) - 1]._key).toBe('p3')
  expect(JSON.stringify(draft.filter((b) => b !== image))).toBe(JSON.stringify(stored))
})

// task-283bdc577aedb167: a save sends the blocks typed in only, by key (Barkpark's keyed
// patch paths), not the whole field: on a 300-block body the field went whole at 337 KB a save.
// A block that comes or goes (Enter) still sends the field.
test('@local Portable Text: typing in a block saves that block by its key, not the whole field', async ({page}, info) => {
  const editor = await open(page, info)
  const saves: string[] = []
  page.on('request', (r) => r.method() === 'POST' && /_serverFn/.test(r.url()) && (r.postData() ?? '').includes(ID) && saves.push(r.postData()!))
  await selectWarm(page, editor)
  await page.keyboard.type('hot')
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('Brew the tea with hot water.')
  const typed = saves.filter((s) => s.includes('hot'))
  expect(typed.length).toBeGreaterThan(0)
  for (const s of typed) {
    // That block, by its key; none of the others (their words) went with it.
    expect(s).toContain('[_key==')
    expect(s).toContain('p1')
    for (const other of ['Steep it for', 'Cups', 'Pour slowly', 'the tea maker']) expect(s).not.toContain(other)
  }
  const one = Math.max(...typed.map((s) => s.length))
  // A new block (Enter): the whole field goes, every block in it.
  saves.length = 0
  await page.keyboard.press('Enter')
  await page.keyboard.type('Cool')
  await savesLanded(page)
  // The block splits at the caret ("…with hot" | " water."), the new one typed into.
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('Cool water.')
  const whole = saves.find((s) => s.includes('Cups') && s.includes('the tea maker'))
  expect(whole).toBeTruthy()
  expect(one).toBeLessThan(whole!.length)
  // What is stored: the typed words where they were typed, every key kept.
  const body = ((await read('drafts'))!.body ?? []) as typeof BODY
  expect(body.map((b) => b._key).filter((k) => !/^[0-9a-f]{12}$/.test(k))).toEqual(['p1', 'p2', 'c1', 'p3', 'p4', 'p5'])
  expect(body[0]!.children[0]!.text).toBe('Brew the tea with hot')
  expect(body[1]!.children.map((c) => c.text).join('')).toBe('Cool water.')
})

/** The caret at the end of the span holding exactly `text`, once the editor has read the click. */
async function caretAtEnd(page: import('@playwright/test').Page, editor: import('@playwright/test').Locator, text: string) {
  await editor.getByText(text, {exact: true}).click()
  await editor.evaluate((el, text) => {
    const span = [...el.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent === text)!.firstChild!
    getSelection()!.collapse(span, text.length)
  }, text)
  await page.waitForTimeout(200)
}

// task-283bdc577aedb167, with saves by key: another editor removes the block being typed in
// while this editor's keystrokes in it are still on their way. The key then finds no item
// (Barkpark's patch.path_unmatched) or the fence refuses the save (412); either way the field
// goes whole again as this editor has it, on the rev that came back: no keystroke is lost.
// (Removed while this editor has nothing unsent in it, the block goes here too, live, as in
// Sanity: task-39d73a15a48563b0.)
test('@local Portable Text: a block another editor removes mid-typing comes back with every keystroke', async ({page}, info) => {
  const editor = await open(page, info)
  await caretAtEnd(page, editor, 'Cups')
  await page.keyboard.type(' and')
  await savesLanded(page)
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).toContain('Cups and')
  // This editor's next save held on its way while the other editor (the rig's own token)
  // removes that block from the draft.
  let release = () => {}
  const held = new Promise<void>((go) => (release = go))
  await page.route(/_serverFn/, async (route) => (route.request().method() === 'POST' && (route.request().postData() ?? '').includes(ID) ? (await held, route.continue()) : route.continue()))
  await page.keyboard.type(' saucers')
  await page.waitForTimeout(500)
  await bpMutate([{patch: {id: ID, type: 'post', unset: ['body[_key=="p3"]']}}])
  await expect.poll(async () => JSON.stringify((await read('drafts'))?.body), {timeout: 10_000}).not.toContain('Cups')
  release()
  await savesLanded(page)
  type Block = {_key: string; children?: {text: string}[]}
  await expect
    .poll(async () => (((await read('drafts'))?.body ?? []) as Block[]).find((b) => b._key === 'p3')?.children?.map((c) => c.text).join(''), {timeout: 15_000})
    .toBe('Cups and saucers')
  const keys = (((await read('drafts'))!.body ?? []) as Block[]).map((b) => b._key)
  expect(keys).toEqual(['p1', 'p2', 'c1', 'p3', 'p4', 'p5'])
  await page.unrouteAll({behavior: 'ignoreErrors'})
})

// task-283bdc577aedb167: two editors typing in different blocks of one body at once both keep
// their words (saves by key; whole-field saves raced for the field). task-39d73a15a48563b0: each sees the
// other's blocks while typing, and undo is each editor's own.
test('@local Portable Text: two editors typing in different blocks at once both keep their text', async ({page, browser}, info) => {
  const t = target(info)
  const ctxB = await browser.newContext()
  await t.prepare(ctxB)
  const b = await ctxB.newPage()
  try {
    const [edA, edB] = await Promise.all([open(page, info), open(b, info)])
    await caretAtEnd(page, edA, 'Pour slowly')
    await caretAtEnd(b, edB, 'Cups')
    await Promise.all([
      (async () => { for (const w of [' from', ' a', ' height']) await page.keyboard.type(w, {delay: 60}) })(),
      (async () => { for (const w of [' and', ' fine', ' saucers']) await b.keyboard.type(w, {delay: 60}) })(),
    ])
    await Promise.all([savesLanded(page), savesLanded(b)])
    type Block = {_key: string; children?: {text: string}[]}
    const text = async (key: string) => (((await read('drafts'))?.body ?? []) as Block[]).find((x) => x._key === key)?.children?.map((c) => c.text).join('')
    await expect.poll(() => text('p4'), {timeout: 15_000}).toBe('Pour slowly from a height')
    await expect.poll(() => text('p3'), {timeout: 15_000}).toBe('Cups and fine saucers')
    // Live, as Sanity's: each sees the other's words while still typing (focus kept), and
    // undo takes back only this editor's own last words.
    await expect(edA).toContainText('Cups and fine saucers')
    await expect(edB).toContainText('Pour slowly from a height')
    await expect(edA).toBeFocused()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => text('p4'), {timeout: 15_000}).toBe('Pour slowly from a')
    expect(await text('p3')).toBe('Cups and fine saucers')
  } finally {
    await closeAndSettle(b)
    await ctxB.close()
  }
})
