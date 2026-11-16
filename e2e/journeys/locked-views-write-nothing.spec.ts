import {expect, test, type Page} from '../rig/test'
import {bpBase, bpDataset, closeAndSettle, target, type Target} from '../rig/targets'

// The locked views besides Published write nothing (app/src/lib/form-lock.ts): a history
// revision and a scheduled doc. Before (196b3cd5, task-476d0bec44dfc219, task-9e39c9999dbe2277,
// task-9f95c023017b6fd7) a note's Freeform canvas took typing in both and saved it to the draft,
// the document menu's Paste document was offered in both, and Cmd+Z in a revision undid the
// last edit in the draft. Drafts are compared by content, read from Barkpark under the doc's
// own type. Each check is soft, so a failing run names every way that wrote.
const stamp = Date.now().toString(36)
const NOTE = `note-lock-${stamp}`
const DOC = `fieldTypes-lock-${stamp}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})
let schedule: string | undefined

// The draft (or, with none, the published version) as Barkpark has it: its fields, not its stamps.
async function held(type: string, id: string) {
  const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/${type}/${encodeURIComponent(id)}?perspective=drafts`, {headers: auth()})
  const {result} = (await r.json()) as {result?: Record<string, unknown>}
  return JSON.stringify(Object.fromEntries(Object.entries(result ?? {}).filter(([k]) => !k.startsWith('_') || k === '_draft')))
}
// Writes come late (a canvas batch, a clipboard read): watched a moment, not read once.
async function unchanged(page: Page, type: string, id: string, before: string) {
  for (const until = Date.now() + 1000; Date.now() < until && (await held(type, id)) === before; ) await page.waitForTimeout(150)
  await page.waitForFunction(() => !(window as unknown as {__savesPending: () => boolean}).__savesPending())
  return held(type, id)
}
async function newestRevision(t: Target, type: string, id: string) {
  await expect.poll(() => t.historyReady(id)).toBe(true)
  const r = await fetch(`${bpBase()}/v1/data/history/${bpDataset()}/${type}/${encodeURIComponent(id)}?limit=10`, {headers: auth()})
  return ((await r.json()) as {revisions: {id: string; status: string}[]}).revisions.find((v) => v.status === 'published')!.id
}
async function typeInto(page: Page, words: RegExp, text: string) {
  await page.getByText(words).first().click({force: true})
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}
async function pasteOffered(page: Page) {
  await page.getByRole('button', {name: 'Show document actions'}).first().click()
  const paste = page.getByRole('menuitem', {name: 'Paste document'})
  const offered = await paste.isEnabled()
  await page.keyboard.press('Escape')
  return offered
}

test.beforeEach(({}, info) => test.skip(target(info).name !== 'studio', 'ours: the lock is ours'))
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (schedule) await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}/${encodeURIComponent(schedule)}`, {method: 'DELETE', headers: auth()})
  schedule = undefined
  await Promise.all([target(info).deleteDoc(NOTE, 'note'), target(info).deleteDoc(DOC, 'fieldTypes')])
})

test('a history revision writes nothing: the Freeform canvas, the body canvas, Paste document', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(NOTE, 'note', {title: 'Locked note', label: 'L', body: {blocks: [para('n1', 'Note words here.')]}}).then(() => t.restore(NOTE, {}, 'note')), t.prepare(page.context())])
  const rev = await newestRevision(t, 'note', NOTE)
  await page.goto(`${t.docPath('note', NOTE)},rev=${rev}`)
  await t.settle(page)
  const before = await held('note', NOTE)
  // The canvas holds the draft, not this revision: a revision is read in Classic, as Published.
  await expect.soft(page.getByRole('tab', {name: 'Freeform'})).toHaveCount(0, {timeout: 1000})
  await expect.soft(page.locator('[id="body"] [contenteditable="true"]')).toHaveCount(0, {timeout: 1000})
  await typeInto(page, /Note words here/, ' typed in a revision')
  expect.soft(await pasteOffered(page), 'Paste document is offered').toBe(false)
  expect.soft(await unchanged(page, 'note', NOTE, before), 'typing in a revision wrote the draft').toBe(before)
})

test('a scheduled doc writes nothing: the Freeform canvas, Paste document', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(NOTE, 'note', {title: 'Locked note', label: 'L', body: {blocks: [para('n1', 'Note words here.')]}}), t.prepare(page.context())])
  const made = await fetch(`${bpBase()}/v1/data/schedules/${bpDataset()}`, {method: 'POST', headers: {...auth(), 'content-type': 'application/json'}, body: JSON.stringify({id: NOTE, type: 'note', publishAt: new Date(Date.now() + 3 * 86_400_000).toISOString()})})
  test.skip(made.status === 404, 'this Barkpark has no scheduled publishes yet (#22775)')
  schedule = ((await made.json()) as {schedule?: {id: string}}).schedule?.id
  await page.goto(t.docPath('note', NOTE))
  await t.settle(page)
  await expect(page.locator('.chip[data-tone=scheduled]')).toBeVisible()
  const before = await held('note', NOTE)
  // Still the canvas, read-only, as the scheduled form is.
  await expect.soft(page.locator('.pd-editor bp-paper-canvas').first()).toHaveAttribute('editable', 'false', {timeout: 2000})
  await typeInto(page, /Note words here/, ' typed while scheduled')
  expect.soft(await pasteOffered(page), 'Paste document is offered').toBe(false)
  expect.soft(await unchanged(page, 'note', NOTE, before), 'typing in a scheduled doc wrote the draft').toBe(before)
})

test('Cmd+Z in a history revision leaves the draft alone', async ({page}, info) => {
  const t = target(info)
  await Promise.all([t.draftOnly(DOC, 'fieldTypes', {title: 'Undo'}).then(() => t.restore(DOC, {}, 'fieldTypes')), t.prepare(page.context())])
  await page.goto(t.docPath('fieldTypes', DOC))
  await t.settle(page)
  await t.field(page, 'title').fill('Undo A')
  await expect.poll(() => t.docValue(DOC, 'title', 'fieldTypes')).toBe('Undo A')
  // Into a revision in the same page, so the pane's undo still holds the edit.
  await expect.poll(() => t.historyReady(DOC)).toBe(true)
  await page.getByRole('button', {name: 'Show document actions'}).first().click()
  await page.getByRole('menuitem', {name: 'History'}).click()
  await page.getByRole('list', {name: 'Document revisions'}).getByRole('button').filter({hasText: 'Published'}).first().click()
  await expect.poll(() => decodeURIComponent(page.url())).toMatch(/rev=[0-9a-f-]+/)
  const before = await held('fieldTypes', DOC)
  await page.getByRole('button', {name: 'Show document actions'}).first().focus()
  await page.keyboard.press('ControlOrMeta+z')
  expect.soft(await unchanged(page, 'fieldTypes', DOC, before), 'Cmd+Z in a revision wrote the draft').toBe(before)
})
