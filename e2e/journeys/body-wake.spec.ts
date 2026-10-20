import {expect, test} from '@playwright/test'
import {BACKEND_POLL, target, closeAndSettle} from '../rig/targets'

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
  // Sanity's box is 306 px with a short body as with a long one (the text scrolls inside), asleep and awake.
  const height = async () => Math.round((await body.boundingBox())!.height)
  expect(await height()).toBe(306)
  await body.click()
  // At once, before the canvas is up; Enter too, which once left a stray line break in
  // the new paragraph ("Plugh\n": #797, caught only by the @local test below).
  await page.keyboard.type('XYZZY', {delay: 20})
  await page.keyboard.press('Enter')
  await page.keyboard.type('Plugh', {delay: 20})
  await expect(body.locator('.ProseMirror')).toContainText('Plugh', {timeout: 15_000})
  expect(await height()).toBe(306)
  const lines = async () => (((await t.docValue(ID, 'body')) as {blocks?: {content?: {value?: string}[]}[]} | undefined)?.blocks ?? []).map((b) => (b.content ?? []).map((c) => c.value ?? '').join(''))
  await expect.poll(async () => (await lines()).join('|'), {...BACKEND_POLL, timeout: 15_000}).toMatch(/XYZZY\|Plugh(\||$)/)
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

// task-6a29d198c08c9123: on a slow computer the canvas took the focus before the caret
// was where the click put it, so End + Enter + text typed at once after the first click
// went in at the canvas's own first caret (before the clicked line). The CPU at 6x
// slower; WAKE_RUNS=20 for the full proof (the suite runs two).
const LINE_END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})
test('@local J10: on a slow computer, End, Enter and text right after the first click go after the clicked line', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the wake-up is our read-only body')
  const runs = Number(process.env.WAKE_RUNS ?? 2)
  test.setTimeout(runs * 45_000 + 30_000) // a page load at 6x on a busy machine can take 20 s
  await t.prepare(page.context())
  before = await t.docValue(ID, 'body')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: 6})
  const lines = async () => (((await t.docValue(ID, 'body')) as {blocks?: {content?: {value?: string}[]}[]} | undefined)?.blocks ?? []).map((b) => (b.content ?? []).map((c) => c.value ?? '').join(''))
  const misses: string[] = []
  for (let i = 0; i < runs; i++) {
    await t.restore(ID, {body: {blocks: [para('wa', 'Alpha line.'), para('wb', 'Beta line.'), para('wc', 'Gamma line.')]}})
    await page.goto(t.docPath('post', ID))
    await t.settle(page)
    const body = page.locator('[id="body"]')
    await body.scrollIntoViewIfNeeded()
    await body.locator('[data-bp-id="wb"]').click()
    await page.keyboard.press(LINE_END)
    await page.keyboard.press('Enter')
    await page.keyboard.type(`Mark${i}`)
    // Gently: a refused read (the suite's shared rate budget) reads as no blocks.
    await expect.poll(async () => (await lines()).join('|').includes(`Mark${i}`), {timeout: 15_000, intervals: [500]}).toBe(true)
    await page.waitForTimeout(500)
    let got = ''
    await expect.poll(async () => (got = (await lines()).join(' | ')), {timeout: 10_000, intervals: [500]}).not.toBe('')
    if (got !== `Alpha line. | Beta line. | Mark${i} | Gamma line.`) misses.push(`run ${i}: ${got}`)
  }
  expect(misses, `${misses.length} of ${runs} misplaced`).toEqual([])
})
