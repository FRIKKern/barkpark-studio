import {expect, test} from '@playwright/test'
import {target, closeAndSettle} from '../rig/targets'

// J10, F8 (nothing lost): the body is read-only until a click wakes Barkpark's canvas,
// which takes a moment on a fresh page (its bundle, the blocks). Keys typed in that
// moment used to vanish; now they are kept and typed in once the canvas has the caret.
const ID = 'post-29'
let before: unknown
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (before !== undefined) await target(info).restore(ID, {body: before})
  before = undefined
})

test('J10: keys typed while the body wakes up are all kept', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the wake-up is our read-only body')
  await t.prepare(page.context())
  before = await t.docValue(ID, 'body')
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const body = page.locator('[id="body"]')
  await body.scrollIntoViewIfNeeded()
  await body.click()
  await page.keyboard.type('XYZZY', {delay: 20}) // at once, before the canvas is up
  await expect(body.locator('.ProseMirror')).toContainText('XYZZY', {timeout: 15_000})
  await expect.poll(async () => JSON.stringify(await t.docValue(ID, 'body')), {timeout: 15_000}).toContain('XYZZY')
})

test('@local J10: Enter while the body wakes is a paragraph break, and another field keeps its own keys', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the wake-up is our read-only body')
  await t.prepare(page.context())
  before = await t.docValue(ID, 'body')
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const body = page.locator('[id="body"]')
  await body.scrollIntoViewIfNeeded()
  await body.click()
  await page.keyboard.type('One', {delay: 10})
  await page.keyboard.press('Enter')
  await page.keyboard.type('Two', {delay: 10})
  await expect(body.locator('.ProseMirror')).toContainText('Two', {timeout: 15_000})
  await expect.poll(async () => ((await t.docValue(ID, 'body')) as {blocks: {content?: {value?: string}[]}[]}).blocks.some((b) => (b.content ?? []).map((c) => c.value ?? '').join('') === 'Two'), {timeout: 15_000}).toBe(true)
  // Reload, wake the body, and go straight to the title: its keys are the title's.
  await page.reload()
  await t.settle(page)
  await body.scrollIntoViewIfNeeded()
  await body.click()
  await t.field(page, 'title').click()
  await page.keyboard.type('Zq', {delay: 10})
  await expect(t.field(page, 'title')).toHaveValue(/Zq$/)
  await page.waitForTimeout(1500)
  expect(JSON.stringify(await t.docValue(ID, 'body'))).not.toContain('Zq')
  await t.restore(ID, {title: 'Fixture post 29'})
})
