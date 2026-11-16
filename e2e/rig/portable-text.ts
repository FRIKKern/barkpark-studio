import {expect, type Locator, type Page, type TestInfo} from '@playwright/test'
import {bpBase, bpDataset, target} from './targets'

// The Portable Text field's fixture, for portable-text.spec and portable-text-edit.spec
// (one spec split for CI's shards, task-c1df532bed870536): a body with custom blocks,
// inline objects, unknown marks and markDefs, and the steps both specs take on it.
// Made-up content (the repo is public).
export 
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

export type Doc = {_rev: string; _updatedAt?: string; body?: unknown}
/** The post as Barkpark stores it, draft or published. */
export const readDoc = async (id: string, perspective: 'drafts' | 'published'): Promise<Doc | undefined> => {
  const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/post/${id}?perspective=${perspective}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  return r.ok ? ((await r.json()) as {result: Doc}).result : undefined
}

/** The body's input: its toolbar, not another Portable Text field's (ptBody is one too). */
export const field = (page: Page) => page.locator('.pt-input').filter({has: page.locator('[id="body"][contenteditable="true"]')})

export async function openBody(page: Page, info: TestInfo, id: string) {
  const t = target(info)
  await page.goto(t.docPath('post', id))
  await t.settle(page)
  await page.getByRole('tab', {name: 'All fields'}).click()
  const editor = page.locator('[id="body"][contenteditable="true"]')
  await expect(editor).toContainText('Brew the tea with warm water.')
  // The editor has read the value (its 'ready'): a click before that places no caret.
  await field(page).and(page.locator('[data-ready]')).waitFor()
  return editor
}

/**
 * "warm" selected by a double click, as a person does. The editor focused first and seen to
 * have read the caret (the style button names its block's style): a double click as the
 * editor first takes focus could be split by that render and select nothing (CI flaked once).
 */
export async function selectWarm(page: Page, editor: Locator) {
  const text = editor.getByText('Brew the tea with warm water.')
  await text.click({position: {x: 135, y: 8}})
  await expect(field(page).locator('.body-style')).toHaveText('Normal')
  await text.dblclick({position: {x: 135, y: 8}})
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toBe('warm')
}
