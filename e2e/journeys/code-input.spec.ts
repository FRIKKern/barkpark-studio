import {expect, test} from '../rig/test'
import {bpBase, bpDataset, bpMutate, closeAndSettle, savesLanded, signInIfAsked, target} from '../rig/targets'

// The code field (Sanity's @sanity/code-input): `{_type: 'code', language, filename, code,
// highlightedLines}` edited in a code editor. As a block in a Portable Text field it is a card
// with its code, edited in the block's dialog: typed code, a picked language and a highlighted
// line land in Sanity's shape and hold over a reload, and a code block that was not touched
// goes back as it was stored (a Sanity import's line endings and extra keys included). That
// test needs no schema of ours, so it runs on every dataset. As a field (fieldTypes' Snippet)
// each part saves to its own path; that test skips where the dataset's schema has no such
// field yet (CI reads the fixture schemas on a pull request that changes them; the pool's
// datasets get them at the next reseed).
const POST = `post-code-${Date.now().toString(36)}`
const FIXTURE = 'field-types-01'
const block = (key: string, text: string) => ({_key: key, _type: 'block', style: 'normal', markDefs: [], children: [{_key: `${key}s`, _type: 'span', marks: [], text}]})
const HELD = {_key: 'held', _type: 'code', language: 'golang', filename: 'main.go', code: 'package main\r\n\r\nfunc main() {}', highlightedLines: [3], theme: {dark: true}}
const BODY = [block('p1', 'Before'), {_key: 'mine', _type: 'code', language: 'rust', code: 'fn main() {}'}, HELD]
const doc = async (type: string, id: string): Promise<Record<string, unknown> | undefined> => {
  const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/${type}/${id}?perspective=drafts`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  return r.ok ? ((await r.json()) as {result: Record<string, unknown>}).result : undefined
}

test('a code block in a Portable Text field: its card shows the code; the dialog edits code, language and a highlighted line; held over a reload; an untouched block stays as stored', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: Sanity edits its own code block; the desk has no Portable Text input')
  await bpMutate([{createOrReplace: {_id: POST, _type: 'post', title: 'Code notes', ptBody: BODY}}])
  try {
    await page.goto(t.docPath('post', POST))
    await t.settle(page)
    await page.getByRole('tab', {name: 'All fields'}).click()
    await page.locator('.pt-input[data-ready]').filter({has: page.locator('[id="ptBody"]')}).waitFor()
    const cards = page.locator('[id="ptBody"] .pt-object[data-type="code"]')
    // A card: the block's filename and language, its code, the highlighted line marked.
    await expect(cards.nth(1).locator('.pt-object-preview')).toHaveText('main.go · Go')
    await expect(cards.nth(1).locator('.code-static .cm-code-highlight')).toHaveText(/func main\(\) \{\}/)
    await cards.first().dblclick()
    const dialog = page.getByRole('dialog', {name: 'Code'})
    const code = dialog.locator('.cm-content')
    // A stored language the list does not offer stays picked, never silently changed.
    await expect(dialog.locator('select')).toHaveValue('rust')
    await code.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('\nconst answer = 42')
    await expect(code).toBeFocused() // the dialog never takes the caret back mid-word
    await dialog.locator('select').selectOption('typescript')
    await dialog.locator('.cm-lineNumbers .cm-gutterElement', {hasText: '2'}).click()
    await expect(dialog.locator('.cm-code-highlight')).toHaveText('const answer = 42')
    await expect(dialog.locator('.cm-content .tok-keyword')).toHaveText('const') // coloured as TypeScript
    await dialog.getByRole('button', {name: 'Close dialog'}).click()
    await savesLanded(page)
    const body = () => doc('post', POST).then((d) => d?.ptBody as Record<string, unknown>[] | undefined)
    await expect.poll(async () => (await body())?.find((b) => b._key === 'mine'), {timeout: 10_000}).toEqual({_key: 'mine', _type: 'code', language: 'typescript', code: 'fn main() {}\nconst answer = 42', highlightedLines: [2]})
    expect((await body())!.find((b) => b._key === 'held')).toEqual(HELD)
    await page.reload()
    await t.settle(page)
    await page.locator('.pt-input[data-ready]').filter({has: page.locator('[id="ptBody"]')}).waitFor()
    await expect(cards.first().locator('.pt-object-preview')).toHaveText('TypeScript')
    await expect(cards.first().locator('.code-static .cm-code-highlight')).toHaveText(/const answer = 42/)
  } finally {
    await closeAndSettle(page)
    await bpMutate([{delete: {id: POST, type: 'post', force: true}}]).catch(() => {})
  }
})

test('a code field: typed code, a picked language, a filename and a highlighted line each save to their own path and hold over a reload', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: the reference studio has no code-input plugin installed')
  await t.prepare(context)
  await page.goto(t.docPath('fieldTypes', FIXTURE))
  await signInIfAsked(page)
  await t.settle(page)
  const code = page.locator('[id="snippet.code"]')
  await page.locator('[id="lockedNote"]').waitFor()
  test.skip((await page.locator('[id="snippet"]').count()) === 0, "this dataset's fieldTypes schema has no Snippet field yet (fixtures/barkpark-schema/fieldTypes.json; reseed with --schemas)")
  try {
    await code.click()
    await page.keyboard.type('const a = 1\nconst b = 2')
    // The first code stores the object's type and the language the picker shows (options.language).
    await expect.poll(() => t.docValue(FIXTURE, 'snippet', 'fieldTypes'), {timeout: 10_000}).toEqual({_type: 'code', language: 'typescript', code: 'const a = 1\nconst b = 2'})
    await page.locator('[id="snippet.language"]').selectOption('javascript')
    await page.locator('[id="snippet.filename"]').fill('a.js')
    await page.locator('.code-box .cm-lineNumbers .cm-gutterElement', {hasText: '2'}).click()
    await expect.poll(() => t.docValue(FIXTURE, 'snippet', 'fieldTypes'), {timeout: 10_000}).toEqual({_type: 'code', language: 'javascript', filename: 'a.js', code: 'const a = 1\nconst b = 2', highlightedLines: [2]})
    // A line typed above moves the highlight with its line; Tab indents, Escape then Tab leaves the editor.
    await code.click()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.type('// top\n')
    await expect.poll(() => t.docValue(FIXTURE, 'snippet', 'fieldTypes').then((s) => (s as {highlightedLines?: number[]}).highlightedLines), {timeout: 10_000}).toEqual([3])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await expect(code).not.toBeFocused()
    await savesLanded(page)
    await page.reload()
    await t.settle(page)
    await expect(code).toHaveText(/\/\/ top/)
    await expect(page.locator('[id="snippet.language"]')).toHaveValue('javascript')
    await expect(page.locator('[id="snippet.filename"]')).toHaveValue('a.js')
    await expect(page.locator('.code-box .cm-code-highlight')).toHaveText('const b = 2')
  } finally {
    await closeAndSettle(page)
    await t.resetDoc(FIXTURE, 'fieldTypes')
  }
})
