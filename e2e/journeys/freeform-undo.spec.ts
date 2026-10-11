import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {target, closeAndSettle} from '../rig/targets'

// D08 (Freeform side track, ours only): in note-01's canvas, type, paste, then undo
// twice and redo once (Cmd/Ctrl+Z, Shift+Z). Each step is saved: the server holds the
// undone state, not just the screen. Stills in e2e/evidence/D08-*.
const ID = 'note-01'
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${ID}"`))!) as {title: string; label: string; body: unknown}
const P = 'A note opens in the canvas; its title and label are field blocks.'
type Block = {id: string; content?: {value?: string}[]}
let before: Block[] | undefined
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio' && before) await target(info).restore(ID, {title: SEED.title, label: SEED.label, body: SEED.body, blocks: before}, 'note')
})

test('@local D08: undo and redo, a paste included; the server holds the undone state', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const blocks = async () => (await t.docValue(ID, 'blocks', 'note')) as Block[]
  const text = async () => {
    const b = await blocks()
    return b.filter((x) => x.content).map((x) => x.content!.map((c) => c.value ?? '').join('')).join(' | ')
  }
  const saved = (want: RegExp | string) => expect.poll(text, {timeout: 10_000}).toMatch(want)
  before = await blocks()
  await page.goto(t.docPath('note', ID))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')

  await canvas.getByText(P).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Typed.')
  await saved(`${P} Typed.`)

  // Paste a line at the caret (a moment later, so undo takes it apart from the typing).
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    const d = new DataTransfer()
    d.setData('text/plain', ' Pasted.')
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', {clipboardData: d, bubbles: true, cancelable: true}))
  })
  await saved(`${P} Typed. Pasted.`)
  await page.screenshot({path: 'evidence/D08-1-typed-pasted-studio.png'})

  // Undo the paste, then the typing: saved each time.
  await page.keyboard.press(`${mod}+z`)
  await saved(new RegExp(`${P.replace(/[.;]/g, '\\$&')} Typed\\. \\|`))
  await page.keyboard.press(`${mod}+z`)
  await saved(new RegExp(`fields? blocks\\. \\|`))
  expect(await text()).not.toContain('Typed')
  await page.screenshot({path: 'evidence/D08-2-undone-studio.png'})

  // Redo brings the typing back, and the server has it.
  await page.keyboard.press(`${mod}+Shift+z`)
  await saved(`${P} Typed.`)
  expect(await text()).not.toContain('Pasted')
  expect((await blocks()).map((b) => b.id), 'no block lost or added').toEqual(before.map((b) => b.id))
})
