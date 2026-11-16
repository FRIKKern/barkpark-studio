import {expect, test} from '../rig/test'
import {closeAndSettle, target} from '../rig/targets'

// A read-only view writes nothing, however it is reached (app/src/lib/form-lock.ts): in the
// Published view, Cmd/Ctrl+V on the focusable "Show all N items" (a copied field in hand), the
// array item's dialog (drawn outside the form's disabled fieldset) and a post's Body canvas
// (clicked, typed into) each wrote a draft before (5c7e2ab4; the body also on main,
// task-d0d758ab8deeed39). Each is checked softly, so a failing run names every way that wrote.
const stamp = Date.now().toString(36)
const ID = `fieldTypes-ro-${stamp}`
const SRC = `fieldTypes-ro-src-${stamp}`
const POST = `post-ro-${stamp}`
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})
const sections = (tag: string) => Array.from({length: 6}, (_, i) => ({_key: `s${i}`, title: `Section ${i + 1}${tag}`, items: [{_key: `s${i}i1`, label: `Item ${i + 1}.1`}]}))

test.beforeEach(({}, info) => test.skip(target(info).name === 'sanity', 'ours: the guard is ours'))
test.afterEach(async ({page}, info) => (await closeAndSettle(page), await Promise.all([target(info).deleteDoc(ID, 'fieldTypes'), target(info).deleteDoc(SRC, 'fieldTypes'), target(info).deleteDoc(POST, 'post')])))

test('the Published view writes nothing: a paste on Show all, an array item dialog, the body canvas', async ({page}, info) => {
  const t = target(info)
  await Promise.all([
    t.draftOnly(SRC, 'fieldTypes', {title: 'Source', sections: sections(' (src)')}),
    t.draftOnly(ID, 'fieldTypes', {title: 'Read only'}).then(() => t.restore(ID, {sections: sections('')}, 'fieldTypes')),
    t.draftOnly(POST, 'post', {title: 'Read only body'}).then(() => t.restore(POST, {body: {blocks: [para('p1', 'Published words.')]}}, 'post')),
    t.prepare(page.context()),
    page.context().grantPermissions(['clipboard-read', 'clipboard-write']),
  ])
  const sectionsField = page.locator('[id="sections"]').locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " field ")][1]')

  // A copied `sections` field (Cmd/Ctrl+C on its toggle), from another document.
  await page.goto(t.docPath('fieldTypes', SRC))
  await t.settle(page)
  await sectionsField.getByRole('button', {name: 'Show all 6 items'}).focus()
  await page.keyboard.press('ControlOrMeta+c')

  // The Published view, an item's dialog open: its field is locked like the form's.
  await page.goto(`${t.docPath('fieldTypes', ID)},path=${encodeURIComponent('sections[_key=="s5"].items[_key=="s5i1"]')}?perspective=published`)
  await t.settle(page)
  await expect.soft(page.getByRole('dialog').last().getByRole('textbox', {name: 'Label'})).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The paste on "Show all", focusable in the locked form: refused.
  await sectionsField.getByRole('button', {name: 'Show all 6 items'}).focus()
  await page.keyboard.press('ControlOrMeta+v')

  // A post's body canvas in the Published view: a click doesn't wake it; typing goes nowhere.
  await page.goto(`${t.docPath('post', POST)}?perspective=published`)
  await t.settle(page)
  await page.locator('[id="body"]').click()
  await page.keyboard.type(' xyz')
  await expect.soft(page.locator('[id="body"]')).toHaveAttribute('aria-readonly', 'true', {timeout: 1000})
  await expect.soft(page.locator('[id="body"] [contenteditable="true"]')).toHaveCount(0, {timeout: 1000})
  await page.waitForFunction(() => !(window as unknown as {__savesPending: () => boolean}).__savesPending())
  expect.soft((await t.versions(ID)).draft, 'the paste or the dialog wrote a draft').toBeUndefined()
  expect.soft((await t.versions(POST)).draft, 'the body canvas wrote a draft').toBeUndefined()
})
