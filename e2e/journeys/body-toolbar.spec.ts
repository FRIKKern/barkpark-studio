import {expect, test} from '@playwright/test'
import {canvasFocusSettled, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// J10 guard (a CI gate): the body field's toolbar runs Barkpark's canvas commands
// (EMBED-CONTRACT 1.2.0, barkpark 3cd936a4). A press applies to the selection and shows
// pressed, the style menu sets a heading, and a script address is refused before it
// reaches the canvas. In a narrow pane the tools that don't fit fold into "Show more"
// menus, as Sanity's, so none spills past the field. The toolbar shows only when the canvas has the commands, so a
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
  // What happened around the selection, for the report when it does not hold: focus
  // moves, keys, the browser's selectionchange and the canvas's transactions (CI ci-3
  // lost the Shift+ArrowLeft selection twice, once even with the canvas flush).
  await page.evaluate(() => {
    const log: string[] = ((window as unknown as {__selLog: string[]}).__selLog = [])
    const at = () => Math.round(performance.now())
    document.addEventListener('focusin', (e) => log.push(`focus ${(e.target as HTMLElement).tagName}.${String((e.target as HTMLElement).className).slice(0, 24)}@${at()}`), true)
    document.addEventListener('keydown', (e) => log.push(`key ${e.key}${e.defaultPrevented ? '!' : ''}@${at()}`), true)
    document.addEventListener('selectionchange', () => log.push(`sel ${JSON.stringify(getSelection()?.toString())}@${at()}`))
  })
  await field.getByText('Body paragraph for post 1.').click()
  await expect(field.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
  await canvasFocusSettled(page)
  await page.keyboard.press('End')
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft')
  // ProseMirror reads a keyboard selection on the browser's selectionchange, a task
  // after the key; a press before that runs on the selection it had (one char, in a
  // CI run; the canvas fix is task-ee29b37ca1c6139d). Wait until the canvas reports the selection.
  await expect
    .poll(() => page.evaluate(() => (document.querySelector('bp-paper-canvas') as unknown as {state(): {selection: {empty: boolean}}}).state().selection.empty))
    .toBe(false)
    .catch(async (e) => {
      const why = await page.evaluate(() => ({active: `${document.activeElement?.tagName}.${String(document.activeElement?.className).slice(0, 40)}`, dom: getSelection()?.toString(), log: (window as unknown as {__selLog?: string[]}).__selLog?.slice(-40)}))
      info.annotations.push({type: 'selection lost', description: JSON.stringify(why)})
      console.log('[selection lost]', JSON.stringify(why))
      throw e
    })
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))
  await bar.getByRole('button', {name: 'Strong'}).click()
  await expect(bar.getByRole('button', {name: 'Strong'})).toHaveAttribute('aria-pressed', 'true')
  await expect(field.locator('.ProseMirror strong')).toHaveText('1.')
  // A script address stays out: the input says so and nothing is linked.
  // As Sanity's, a 600 px field folds the links into the marks' "Show more".
  const link = bar.getByRole('button', {name: 'Link', exact: true})
  if (await link.isVisible()) await link.click()
  else {
    await bar.getByRole('button', {name: 'Show more'}).first().click()
    await page.getByRole('menuitemcheckbox', {name: 'Link', exact: true}).click()
  }
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
  // A narrow field (Presentation's pane is 287 px): the tail folds into "Show more", and
  // no tool lies past the field.
  await field.evaluate((f) => void (f.style.width = '300px'))
  await expect(bar.getByRole('button', {name: 'Show more'}).first()).toBeVisible()
  // A 600 px field already shows a "Show more" (#749), so wait for the refold itself.
  const spill = () =>
    bar.evaluate((b) => {
      const edge = b.closest('.body-canvas')!.getBoundingClientRect().right
      return [...b.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().right > edge).length
    })
  await expect.poll(spill, {timeout: 3000}).toBe(0)
})
