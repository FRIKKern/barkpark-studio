import {expect, test} from '@playwright/test'
import {installProbes, stats, typeAndMeasure} from '../rig/feel'
import {target, closeAndSettle} from '../rig/targets'

// B06 evidence, ours (the reference is Barkpark's LiveView Studio, which lists
// every language as a row; the journey asks for tabs): volume-01's blurb opens
// on its primary language (nob, first of the fallbackChain), keyboard-only tab
// switching (F5), typing in a language (F1), and the fallback note when the
// primary is empty. Stills + a clip go to e2e/evidence/. Not a CI gate.
const ID = 'volume-01'
const BLURB = {nob: 'En bok om felter.', eng: 'A book about fields.'}
const shot = (step: string) => `evidence/B06-studio-${step}.png`
test.use({video: 'on'})
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio') await target(info).restore(ID, {blurb: BLURB}, 'volume')
})

test('@evidence B06: localizedText language tabs', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only type; the reference is the LiveView Studio')
  await installProbes(context)
  await page.goto(t.docPath('volume', ID))
  await t.settle(page)
  await page.getByRole('tab', {name: 'Main'}).click()
  const tabs = page.getByRole('tablist', {name: 'Blurb'})
  const field = page.locator('.field').filter({has: tabs})
  await expect(tabs.getByRole('tab', {selected: true})).toHaveText(/nob/i)
  await expect(t.field(page, 'blurb.nob')).toHaveValue(BLURB.nob)
  await field.screenshot({path: shot('1-primary')})

  // Keyboard only: Tab reaches the selected tab, arrows switch language.
  await tabs.getByRole('tab', {selected: true}).focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.getByRole('tab', {name: /eng/i})).toBeFocused()
  await expect(tabs.getByRole('tab', {selected: true})).toHaveText(/eng/i)
  await expect(t.field(page, 'blurb.eng')).toHaveValue(BLURB.eng)
  await page.keyboard.press('Tab')
  await expect(t.field(page, 'blurb.eng')).toBeFocused()

  // F1 while typing in a language.
  const typed = await typeAndMeasure(page, t.field(page, 'blurb.eng'), ' Now longer.')
  info.annotations.push({type: 'F1 eng', description: JSON.stringify(stats(typed.keys))})
  await expect.poll(() => t.docValue(ID, 'blurb', 'volume'), {timeout: 10_000}).toEqual({...BLURB, eng: `${BLURB.eng} Now longer.`})

  // The primary emptied: its dot goes, and the field says what readers get.
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Home')
  await expect(tabs.getByRole('tab', {selected: true})).toHaveText(/nob/i)
  await t.field(page, 'blurb.nob').fill('')
  await expect(field.getByRole('status')).toHaveText('No nob text: readers get the eng text instead.')
  await field.screenshot({path: shot('2-fallback')})
  await expect.poll(() => t.docValue(ID, 'blurb', 'volume'), {timeout: 10_000}).toEqual({eng: `${BLURB.eng} Now longer.`})
})
