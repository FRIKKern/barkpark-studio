import {expect, test} from '../rig/test'
import {bpMutate, closeAndSettle, target} from '../rig/targets'

// A declared object block (the post body's callout: tone + text) copied and pasted keeps
// its type and fields, as a second one with a new id (Barkpark #22931: the copy came out
// a built-in callout with no text). Ours only: the field canvas. Cut+paste keeping the id
// is left out: the copy path is the data loss, and the 5 s budget is firm.
const ID = `post-clip-${Date.now().toString(36)}` // fresh each run: a reused id carries its delete in its history
type Block = {id: string; type: string; tone?: string; text?: string; content?: {value?: string}[]}
const para = (id: string, value: string) => ({id, type: 'paragraph', content: [{type: 'text', value}]})
const mutate = (mutations: unknown[]) => bpMutate(mutations).then(() => {})
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio') await mutate([{delete: {id: ID, type: 'post', force: true}}]).catch(() => {})
})

test('@local J11: copy+paste keeps a declared callout', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: the canvas host')
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mutate([{createOrReplace: {_id: ID, _type: 'post', title: 'Clipboard', body: {blocks: [para('a', 'Alpha.'), {id: 'co', type: 'callout', tone: 'warning', text: 'Keep me.'}, para('g', 'Gamma.')]}}}])
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  // The body field; the canvas mounts in it on the first click.
  const canvas = page.locator('[id="body"]')
  await canvas.scrollIntoViewIfNeeded()
  await canvas.getByText('Alpha.').click()
  await expect(canvas.locator('.ProseMirror')).toBeFocused({timeout: 15_000})
  const blocks = async () => (((await t.docValue(ID, 'body')) as {blocks?: Block[]})?.blocks ?? [])
  const callouts = async () => (await blocks()).filter((b) => b.type === 'callout').map((b) => `${b.id === 'co' ? 'co' : 'new'} ${b.tone} ${b.text}`)
  // Select the callout: the caret at the end of Alpha, then ArrowDown (#22881); copy; paste after Gamma.
  // The caret is in Alpha already: a beat (a key within ~20 ms of a click acts on the old caret).
  await page.waitForTimeout(100)
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowDown')
  await expect(canvas.locator('.ProseMirror-selectednode')).toHaveAttribute('aria-label', 'Callout · Keep me.')
  await page.keyboard.press(`${mod}+c`)
  await canvas.getByText('Gamma.').click()
  await page.waitForTimeout(100)
  await page.keyboard.press('End')
  await page.keyboard.press(`${mod}+v`)
  await expect.poll(callouts, {timeout: 10_000, intervals: [100]}).toEqual(['co warning Keep me.', 'new warning Keep me.'])
})
