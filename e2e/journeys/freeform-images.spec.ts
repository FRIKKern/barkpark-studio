import {readFileSync} from 'node:fs'
import {expect, test, type Page} from '@playwright/test'
import {target, closeAndSettle} from '../rig/targets'

// D07 (Freeform side track, ours only): a picture pasted into note-01's canvas becomes
// an image block at once (uploading), goes to Barkpark's media, and the block stores
// the file's Barkpark path as its src (shown here through routes/w/$.ts). A dropped
// picture does the same. A failed upload says so on its block. Stills in e2e/evidence/D07-*.
const ID = 'note-01'
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${ID}"`))!) as {title: string; label: string; body: unknown}
const PNG = readFileSync(new URL('../../fixtures/assets/fixture-image.png', import.meta.url)).toString('base64')
type Block = {id: string; type: string; src?: string; alt?: string}
let before: Block[] | undefined
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio' && before) await target(info).restore(ID, {title: SEED.title, label: SEED.label, body: SEED.body, blocks: before}, 'note')
})

/** Paste (or drop, at the element's centre) a PNG as a browser would hand it over. */
const givePicture = (page: Page, how: 'paste' | 'drop', name: string) =>
  page.evaluate(
    ({b64, how, name}) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const d = new DataTransfer()
      d.items.add(new File([bytes], name, {type: 'image/png'}))
      if (how === 'paste') return void document.activeElement?.dispatchEvent(new ClipboardEvent('paste', {clipboardData: d, bubbles: true, cancelable: true}))
      const target = [...document.querySelectorAll('bp-paper-canvas p')].find((p) => p.textContent?.startsWith('See '))!
      const r = target.getBoundingClientRect()
      const at = {clientX: r.left + 20, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, dataTransfer: d}
      target.dispatchEvent(new DragEvent('dragenter', at))
      target.dispatchEvent(new DragEvent('dragover', at))
      target.dispatchEvent(new DragEvent('drop', at))
    },
    {b64: PNG, how, name},
  )

test('@local D07: paste or drop a picture into the canvas — uploaded to Barkpark media; a failure shows on its block', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  const blocks = async () => (await t.docValue(ID, 'blocks', 'note')) as Block[]
  before = await blocks()
  await page.goto(t.docPath('note', ID))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')

  // Paste after the first paragraph.
  await canvas.getByText('A note opens in the canvas').click()
  await givePicture(page, 'paste', 'pasted-sun.png')
  const images = () => blocks().then((b) => b.filter((x) => x.type === 'image'))
  await expect.poll(async () => (await images()).map((x) => `${x.alt}:${!!x.src}`), {timeout: 20_000}).toEqual(['pasted-sun:true'])
  const [pasted] = await images()
  expect(pasted!.src).toMatch(/^\/w\/[^/]+\/p\/[^/]+\/media\/files\//)
  const img = canvas.locator(`img[src="${pasted!.src}"]`)
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), {timeout: 10_000}).toBe(640)
  await page.screenshot({path: 'evidence/D07-1-pasted-studio.png'})

  // Drop on the last paragraph.
  await givePicture(page, 'drop', 'dropped-sun.png')
  await expect.poll(async () => (await images()).map((x) => `${x.alt}:${!!x.src}`).sort(), {timeout: 20_000}).toEqual(['dropped-sun:true', 'pasted-sun:true'])

  // A failed upload stays on its block, with the reason; nothing half-stored.
  // The same picture as above: the library knows its bytes, so the lookup must miss too.
  await page.route('**/api/media/by-sha1?*', (r) => r.fulfill({status: 404}))
  await page.route('**/api/media/upload', (r) => r.fulfill({status: 500, body: 'down'}))
  await canvas.getByText('A note opens in the canvas').click()
  await givePicture(page, 'paste', 'failing.png')
  await expect(canvas.getByText(/upload failed \(500\)/)).toBeVisible({timeout: 10_000})
  await page.screenshot({path: 'evidence/D07-2-failed-studio.png'})
  await page.waitForTimeout(1500)
  info.annotations.push({type: 'stored after a failed upload', description: JSON.stringify((await images()).map((x) => ({alt: x.alt, src: x.src ?? null})))})
})
