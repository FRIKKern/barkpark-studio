import {expect, test} from '@playwright/test'
import {signInIfAsked, target, closeAndSettle} from '../rig/targets'

// J10 guard (a CI gate): the body field's toolbar runs Barkpark's canvas commands
// (EMBED-CONTRACT 1.2.0, barkpark 3cd936a4). A press applies to the selection and shows
// pressed, the style menu sets a heading, and a script address is refused before it
// reaches the canvas. The toolbar shows only when the canvas has the commands, so a
// Barkpark that lost them would hide it: this test fails then instead.
const ID = 'post-01'
let original: unknown
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (original !== undefined) await target(info).restore(ID, {body: original})
})

test('J10: the body toolbar marks, sets a style, and refuses a script link', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's toolbar is the evidence spec's reference")
  original = await t.docValue(ID, 'body')
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const field = page.locator('.body-canvas')
  const bar = field.getByRole('toolbar', {name: 'Formatting'})
  await expect(bar).toBeVisible({timeout: 15_000})
  await field.getByText('Body paragraph for post 1.').click()
  await expect(field.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
  await page.keyboard.press('End')
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft')
  // ProseMirror reads a keyboard selection on the browser's selectionchange, a task
  // after the key; a press before that runs on the selection it had (one char, in a
  // CI run; the canvas fix is task-ee29b37ca1c6139d). Wait until the canvas reports the selection.
  await expect.poll(() => page.evaluate(() => (document.querySelector('bp-paper-canvas') as unknown as {state(): {selection: {empty: boolean}}}).state().selection.empty)).toBe(false)
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))
  await bar.getByRole('button', {name: 'Strong'}).click()
  await expect(bar.getByRole('button', {name: 'Strong'})).toHaveAttribute('aria-pressed', 'true')
  await expect(field.locator('.ProseMirror strong')).toHaveText('1.')
  // A script address stays out: the input says so and nothing is linked.
  await bar.getByRole('button', {name: 'Link', exact: true}).click()
  await page.getByRole('textbox', {name: 'Link'}).fill(' JAVASCRIPT:alert(1)')
  await page.keyboard.press('Enter')
  await expect(page.locator('.body-link-refused')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(field.locator('.ProseMirror a')).toHaveCount(0)
  // The style menu sets a heading on the caret's block.
  await bar.locator('.body-style').click()
  await page.getByRole('menuitemradio', {name: 'Heading 3'}).click()
  await expect(field.locator('.ProseMirror h3')).toContainText('Body paragraph for post 1.')
  await expect(bar.locator('.body-style')).toContainText('Heading 3')
})
