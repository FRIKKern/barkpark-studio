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
  await page.locator('.pt-input[data-ready]').waitFor()
  return editor
}

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
  await editor.getByText('Brew the tea with warm water.').dblclick({position: {x: 135, y: 8}})
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toBe('warm')
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

test('@local Portable Text: styles, lists and decorators edit from the toolbar', async ({page}, info) => {
  const editor = await open(page, info)
  // The beat a person always takes between a click in the text and a toolbar button:
  // the editor reads the browser's selection just after the click.
  const caret = async (text: string, dbl = false) => (await (dbl ? editor.getByText(text).dblclick({position: {x: 10, y: 8}}) : editor.getByText(text).click()), await page.waitForTimeout(150))
  await caret('Cups')
  await page.getByRole('combobox', {name: 'Block style'}).selectOption('h3')
  await caret('Pour slowly')
  await page.getByRole('button', {name: 'Bulleted list'}).click()
  await caret('Brew the tea with warm water.', true)
  await page.getByRole('button', {name: 'Strong'}).click()
  await savesLanded(page)
  await expect
    .poll(async () => {
      const body = ((await read('drafts'))?.body ?? []) as typeof BODY
      return [body[3]?.style, body[4]?.listItem ?? null, body[0]?.children.find((c) => c.text === 'Brew')?.marks]
    }, {timeout: 10_000})
    .toEqual(['h3', null, ['strong']])
})
