import {expect, test, type Page} from '@playwright/test'
import {bpMutate, target} from '../rig/targets'

// D19 (Freeform side track, ours only), after Barkdown's find and replace (#17,
// editor-find.live.mjs): in a fresh note, Ctrl/Cmd+F opens the find bar with the matches
// painted and counted; Enter / Shift+Enter step; Replace takes the current one and
// Replace all the rest, each one transaction, so one undo puts a Replace all back; the
// server agrees after each. Ctrl+H opens it on Replace; Escape closes it and clears the
// paint. Stills in e2e/evidence/D19-*.
const ID = `note-d19-${Date.now().toString(36)}` // fresh each run: a reused id carries its delete in its history
type Block = {type: string; content?: {type: string; value?: string}[]}
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})

const mutate = (mutations: unknown[]) => bpMutate(mutations).then(() => {})
test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio') await mutate([{delete: {id: ID, type: 'note', force: true}}]).catch(() => {})
})

test('@local D19: find and replace in the canvas — count, step, replace, replace all, one-step undo', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  test.setTimeout(60_000)
  await mutate([
    {createOrReplace: {_id: ID, _type: 'note', title: 'D19 find', label: 'Idea', body: {blocks: [para('a', 'The cat sat with a cat.'), para('b', 'No dogs here.'), para('c', 'A Cat at the end.')]}}},
    {publish: {id: ID, type: 'note'}},
  ])
  await page.goto(t.docPath('note', ID))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')
  const bar = page.getByRole('search', {name: 'Find in document'})
  const count = bar.locator('.pd-find-count')
  const text = async () =>
    (((await t.docValue(ID, 'blocks', 'note')) as Block[]) ?? []).filter((b) => b.type === 'paragraph').map((b) => (b.content ?? []).map((x) => x.value).join(''))
  const saved = (want: string[]) => expect.poll(text, {timeout: 10_000}).toEqual(want)
  const undo = async (p: Page) => {
    await p.keyboard.press('Escape') // closes the bar, the caret back in the canvas
    await p.keyboard.press('ControlOrMeta+z')
  }

  // 1. Ctrl/Cmd+F from inside the canvas: the bar, three matches (case-insensitive), the
  // first after the caret active.
  await canvas.locator('.ProseMirror > *', {hasText: 'The cat sat'}).click()
  await page.waitForTimeout(100)
  await page.keyboard.press('Home')
  await page.keyboard.press('ControlOrMeta+f')
  await expect(bar.getByRole('textbox', {name: 'Find'})).toBeFocused()
  await page.keyboard.type('cat')
  await expect(count).toHaveText('1 of 3')
  await expect(canvas.locator('.bp-find-match')).toHaveCount(3)
  await expect(canvas.locator('.bp-find-match--active')).toHaveText('cat')

  // 2. Enter steps on, Shift+Enter back.
  await page.keyboard.press('Enter')
  await expect(count).toHaveText('2 of 3')
  await page.keyboard.press('Shift+Enter')
  await expect(count).toHaveText('1 of 3')
  await page.screenshot({path: 'evidence/D19-1-find-studio.png'})

  // 3. Replace the current one (Enter in Replace with).
  await bar.getByRole('textbox', {name: 'Replace with'}).fill('dog')
  await bar.getByRole('textbox', {name: 'Replace with'}).press('Enter')
  await expect(count).toHaveText('1 of 2')
  await saved(['The dog sat with a cat.', 'No dogs here.', 'A Cat at the end.'])

  // 4. Replace all: the other two, one toast.
  await bar.getByRole('button', {name: 'Replace all'}).click()
  await expect(count).toHaveText('No matches')
  await expect(page.getByText('Replaced 2')).toBeVisible()
  await saved(['The dog sat with a dog.', 'No dogs here.', 'A dog at the end.'])
  await page.screenshot({path: 'evidence/D19-2-replaced-studio.png'})

  // 5. One undo puts the whole Replace all back; Escape cleared the paint.
  await bar.getByRole('textbox', {name: 'Replace with'}).focus()
  await undo(page)
  await expect(bar).toBeHidden()
  await saved(['The dog sat with a cat.', 'No dogs here.', 'A Cat at the end.'])
  await expect(canvas.locator('.bp-find-match')).toHaveCount(0)

  // 6. Ctrl+H opens it on Replace.
  await page.keyboard.press('Control+h')
  await expect(bar.getByRole('textbox', {name: 'Replace with'})).toBeFocused()
  await bar.getByRole('textbox', {name: 'Find'}).fill('dog')
  await expect(count).toHaveText(/ of 2$/) // "dog" and "dogs"; the first after the caret is active
  await page.screenshot({path: 'evidence/D19-3-replace-open-studio.png'})
  expect(page.url(), 'the studio took none of the keys').toContain(`;${ID}`)
})
