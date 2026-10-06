import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// D04 (Freeform side track, ours only): "+" on a type with an Expectation creates the
// doc at once, and Barkpark builds it from the layout and fills it from the prefill.
// note (Freeform-main) opens in the canvas: Title and Label field blocks then an empty
// body block, Label prefilled "Idea", the caret in the first block. story (Expectation,
// Classic) opens with Kicker prefilled "New story", the caret in Title. Stills in
// e2e/evidence/D04-*. The docs it creates are deleted after.
const created: {id: string; type: string}[] = []
test.afterEach(async ({}, info) => {
  for (const d of created.splice(0)) await target(info).deleteDoc(d.id, d.type)
})

const newDoc = async (page: import('@playwright/test').Page, type: string, title: string) => {
  await page.getByRole('button', {name: `Create new ${title}`}).click()
  await expect(page).toHaveURL(new RegExp(`/structure/${type};[0-9a-f-]{36}`))
  const id = /;([0-9a-f-]{36})/.exec(page.url())![1]!
  created.push({id, type})
  return id
}

test('@local D04: new doc from an Expectation — layout scaffold, prefill, caret in the first block', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Expectations')

  // Freeform-main: the canvas.
  await page.goto(t.listPath('note'))
  await t.settle(page)
  const noteId = await newDoc(page, 'note', 'Note')
  const canvas = page.locator(`[data-pane="doc:${noteId}"] bp-paper-canvas`)
  const fields = canvas.locator('.bp-canvas-field')
  await expect(fields).toHaveCount(2, {timeout: 15_000})
  await expect(fields.nth(0).locator('.bp-canvas-field-label')).toHaveText('Title')
  await expect(fields.nth(1).locator('input')).toHaveValue('Idea')
  await expect(fields.nth(0).locator('input')).toBeFocused()
  await page.keyboard.type('A new note')
  await expect.poll(() => t.docValue(noteId, 'title', 'note'), {timeout: 10_000}).toBe('A new note')
  await expect.poll(async () => ((await t.docValue(noteId, 'blocks', 'note')) as {type: string}[]).map((b) => b.type)).toEqual(['field-string', 'field-string', 'paragraph'])
  await page.screenshot({path: 'evidence/D04-1-note-studio.png'})

  // Expectation in Classic.
  await page.goto(t.listPath('story'))
  await t.settle(page)
  const storyId = await newDoc(page, 'story', 'Story')
  await expect(t.field(page, 'kicker')).toHaveValue('New story', {timeout: 15_000})
  await expect(t.field(page, 'title')).toBeFocused()
  await page.screenshot({path: 'evidence/D04-2-story-studio.png'})
  expect(((await t.docValue(storyId, 'blocks', 'story')) as {fieldName?: string}[]).map((b) => b.fieldName ?? '·')).toEqual(['title', 'kicker', 'summary', '·'])
})
