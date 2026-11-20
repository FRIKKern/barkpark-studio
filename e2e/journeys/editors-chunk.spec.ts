import {expect, test, type Page} from '../rig/test'
import {target} from '../rig/targets'

// J20: the document editors' chunk (image/file inputs, body, Review changes) is fetched
// after the desk renders. Offline before it lands, the pane went to "Could not render the
// document editor" and stayed there until a reload (2026-10-11 sign-off pack). Now the
// rest of the form types on, and the inputs come once the chunk can be fetched.
test('J20: the editors chunk failing to load waits, and lands once it can', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  let blocked = true
  await page.route(/doc-editors/, (route) => (blocked ? route.abort('internetdisconnected') : route.continue()))
  await page.goto(t.docPath('post', 'post-17'))
  await t.settle(page)
  const image = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
  await expect(t.field(page, 'title')).toBeEditable()
  await expect(page.getByText('Could not render the document editor')).toHaveCount(0)
  blocked = false
  await expect(image.getByRole('button', {name: 'Upload'})).toBeVisible({timeout: 5_000})
  await expect(page.getByText('Could not render the document editor')).toHaveCount(0)
})

// J36: a click on a server-drawn image field before its chunk lands is held, then made
// once the input is live. The page marks itself interactive first (React hydrates these
// inputs later), and releasing at that mark clicked the inert button: lost (task-63978ba572421248).
test('J36: the first click on Select, before the editors chunk lands, still opens it', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  // On CI this flaked about 1 run in 6 from 2026-10-14 23:52 UTC and never locally
  // (task-0d76ab147c56c3c9): a failure prints where the click went, so the next one says why.
  await page.addInitScript(() => {
    const t0 = performance.now()
    const log: string[] = ((window as {__j36?: string[]}).__j36 = [])
    const say = (s: string) => log.push(`${Math.round(performance.now() - t0)} ${s}`)
    const live = (el: Element) => Object.keys(el).some((k) => k.startsWith('__reactProps$'))
    const name = (el: Element | null) => (el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${el.textContent?.trim().slice(0, 16)}"` : 'none')
    addEventListener('click', (e) => say(`click ${e.isTrusted ? 'trusted' : 'replayed'} on ${name(e.target as Element)} live=${live(e.target as Element)} held=${Array.isArray((window as {__earlyClicks?: unknown}).__earlyClicks)} hydrated=${document.documentElement.hasAttribute('data-hydrated')} at ${e.clientX},${e.clientY}`), true)
    let last = ''
    const watch = () => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Select')
      const r = b?.getBoundingClientRect()
      const k = r ? `${Math.round(r.x)},${Math.round(r.y)} live=${live(b!)}` : 'absent'
      if (k !== last) say(`Select ${(last = k)}`)
      if (performance.now() - t0 < 8_000) requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })
  // A fixed 1 s, not held until the click: held, a client render of the editors' boundary drew
  // no Select and only the chunk draws it, so the test hung (CI 2026-11-20, task-384873db40c1fdb0).
  await page.route(/doc-editors/, async (route) => (await new Promise((r) => setTimeout(r, 1_000)), route.continue()))
  const started = Date.now()
  await page.goto(t.docPath('post', 'post-17'), {waitUntil: 'commit'})
  await page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')}).getByRole('button', {name: 'Select'}).click()
  await expect(page.getByRole('dialog'))
    .toBeVisible({timeout: 5_000})
    .catch(async (err) => {
      console.log(`J36 timeline:\n${((await page.evaluate(() => (window as {__j36?: string[]}).__j36).catch(() => null)) ?? []).join('\n')}`)
      throw err
    })
  // A slow pass says why too (CI: 8 s once, against ~2 s locally).
  if (Date.now() - started > 4_000) console.log(`J36 slow pass, timeline:\n${((await page.evaluate(() => (window as {__j36?: string[]}).__j36).catch(() => null)) ?? []).join('\n')}`)
})

// task-3d93a715c9e2e3d6: the production server names the editors' chunk for a document
// page (modulepreload), so it downloads with the page's code. A renamed entry would drop it silently.
test('J36: a document page preloads the editors chunk (production build)', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio' || !(process.env.CI || process.env.E2E_PROD), 'the production server only (dev has no build manifest)')
  const res = await page.request.get(t.docPath('post', 'post-17'), {maxRedirects: 0})
  expect(res.headers().link).toMatch(/\/assets\/doc-editors-[\w-]+\.js>; rel=modulepreload/)
})

// task-05dcdef359da08fc: the page hydrates without the editors chunk once it is 1.5 s late
// (client.tsx). The chunk's server-drawn inputs (image and file: field-types-01 has both; the
// body canvas is drawn static, outside the chunk) stay drawn from the first paint until it lands,
// however late, and a click or a drop on them meanwhile is held or kept from the browser. The
// cap is passed on a fake clock, so no real second is spent near it.
const LATE = {type: 'fieldTypes', id: 'field-types-01'} as const
async function lateChunk(page: Page, docPath: string, drawn: 'photo' | 'mainImage.alt' = 'photo') {
  await page.addInitScript(() => {
    type Slot = {parent: Element; others: number; name: string}
    const w = window as {__slots?: Slot[]; __emptied?: string[]; __chunkIn?: boolean}
    w.__emptied = []
    // Each server-drawn Suspense boundary in the form (React marks it <!--$--> … <!--/$-->), named
    // by its field (the file input sits in no fieldset: by its class), with its parent's elements
    // outside it: "empty" is the parent holding only those.
    const find = () => {
      const form = document.querySelector('.doc-form')
      if (!form || w.__slots) return
      const slots: Slot[] = []
      const walk = document.createTreeWalker(form, NodeFilter.SHOW_COMMENT)
      for (let c = walk.nextNode(); c; c = walk.nextNode()) {
        if ((c as Comment).data !== '$' || !c.parentElement) continue
        let inside = 0
        let first: Element | null = null
        for (let n = c.nextSibling; n && !(n.nodeType === 8 && (n as Comment).data === '/$'); n = n.nextSibling) if (n.nodeType === 1) (inside++, (first ??= n as Element))
        if (!first) continue
        const name = c.parentElement.closest('fieldset.field')?.querySelector('[id]:not([id^="_"])')?.id ?? String(first.className).split(' ')[0]
        slots.push({parent: c.parentElement, others: c.parentElement.childElementCount - inside, name})
      }
      w.__slots = slots
    }
    const check = () => {
      find()
      if (w.__chunkIn) return
      for (const s of w.__slots ?? []) if ((!s.parent.isConnected || s.parent.childElementCount <= s.others) && !w.__emptied!.includes(s.name)) w.__emptied!.push(s.name)
    }
    new MutationObserver(check).observe(document, {subtree: true, childList: true})
  })
  let release!: () => void
  const late = new Promise<void>((r) => (release = r))
  await page.route(/doc-editors/, async (route) => (await late, route.continue()))
  await page.clock.install()
  await page.goto(docPath, {waitUntil: 'commit'})
  const select = page.locator('fieldset.field').filter({has: page.locator('[id="photo"]')}).getByRole('button', {name: 'Select'})
  await expect(drawn === 'photo' ? select : page.locator(`[id="${drawn}"]`)).toBeVisible()
  // The drop zone where the server drew it (field-types-01 only), in view for the drop row's probe.
  const zone = page.locator('.file-input')
  const dropZone = drawn === 'photo' ? (await zone.scrollIntoViewIfNeeded(), await zone.boundingBox()) : null
  // Past the hydration cap: the page hydrates without the chunk, and the form's first updates
  // run (the comments' answer, task-05dc: it changes a context above the chunk's boundaries).
  await page.clock.fastForward(1_600)
  await expect(page.locator('html[data-hydrated]')).toBeAttached({timeout: 10_000})
  await expect(page.locator('[id="title"]')).toBeEditable()
  await page.waitForTimeout(300) // a few real frames for those updates
  const landed = async () => {
    const r = await page.evaluate(() => {
      const w = window as {__slots?: {name: string}[]; __emptied?: string[]; __chunkIn?: boolean}
      w.__chunkIn = true
      return {slots: (w.__slots ?? []).map((s) => s.name).sort(), emptied: w.__emptied ?? []}
    })
    release()
    await page.clock.resume() // real time again: the chunk's frames, the form's saves
    return r
  }
  return {select, dropZone, landed}
}

// A drop whose default is not prevented opens the file in the tab, leaving the studio. Synthetic
// events have no default action, so the probe reads defaultPrevented, the browser's own cue.
const probe = (page: Page, at: {x: number; y: number} | string, andDrop: boolean) =>
  page.evaluate(({at, andDrop}) => {
    const el = (typeof at === 'string' ? document.querySelector(at) : document.elementFromPoint(at.x, at.y)) ?? document.body
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['x'], 'kept.txt', {type: 'text/plain'}))
    const over = new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer})
    el.dispatchEvent(over)
    const drop = new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer})
    if (andDrop) el.dispatchEvent(drop)
    return {on: String(el.className).split(' ')[0], dragover: over.defaultPrevented, drop: drop.defaultPrevented}
  }, {at, andDrop})
/** The chunk's inputs are live (the file box answers a drop itself), and two frames have passed for their mount. */
const inputsLive = async (page: Page) => {
  await expect.poll(async () => (await probe(page, '.file-input .file-box', false)).dragover, {message: 'the inputs are live', timeout: 5_000}).toBe(true)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

// One page load, one held chunk: the inputs stay drawn, a drop on them is kept from the tab, and a
// press on Select past the page's own click hold (DocEditors.tsx HOLD_MS, 3 s) opens it once the
// chunk lands. Each check is soft and named, so a red run says which of them broke.
test('a field group keeps its inputs drawn while the editors chunk is late; a drop is kept from the tab, a press on Select opens it on landing', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  const {select, dropZone, landed} = await lateChunk(page, t.docPath(LATE.type, LATE.id))
  expect(dropZone, 'the server drew the drop zone').not.toBeNull()
  const held = await probe(page, {x: dropZone!.x + dropZone!.width / 2, y: dropZone!.y + dropZone!.height / 2}, true)
  await page.clock.fastForward(2_000)
  const pressed = await select.click({timeout: 2_000}).then(() => true, () => false)
  const {slots, emptied} = await landed()
  console.log(`late chunk: server boundaries ${JSON.stringify(slots)}; emptied before it landed ${JSON.stringify(emptied)}; drop ${JSON.stringify(held)}`)
  expect.soft(slots, "the server drew the chunk's inputs").toEqual(['file-input', 'photo'])
  expect.soft(emptied, 'no input went missing before the chunk landed').toEqual([])
  expect.soft(held, 'a drop while the chunk is late is kept from the browser').toMatchObject({dragover: true, drop: true})
  expect.soft(pressed, 'Select was there to press while the chunk was late').toBe(true)
  await expect.soft(page.getByRole('dialog'), 'the press on Select opened it once the chunk landed').toBeVisible({timeout: 5_000})
  // The probe reads a live drop zone's answer (a dragover only: a drop there would upload).
  await expect.soft.poll(async () => (await probe(page, '.file-input .file-box', false)).dragover, {message: 'the live drop zone answers the probe', timeout: 5_000}).toBe(true)
})

// The image's own fields (alt) sit outside the chunk's boundary (ImageBox.tsx, ImageFrame): typing in
// one goes on while the chunk is late and as it lands, never swapped away mid-word.
const ALT_ID = `post-late-alt-${Date.now().toString(36)}`
// A fieldTypes document of the rows' own, for the rows that type (field-types-01 is shared) or open a second document.
const PRESS_ID = `field-types-late-${Date.now().toString(36)}`
const PRESS_TITLE = 'Late chunk press probe'
test.afterEach(async ({}, info) => target(info).name === 'studio' && (await Promise.all([target(info).deleteDoc(ALT_ID, 'post'), target(info).deleteDoc(PRESS_ID, 'fieldTypes')])))

test("typing in an image's Alt while the editors chunk is late keeps every letter and the focus as it lands", async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  await t.draftOnly(ALT_ID, 'post', {title: 'Late chunk Alt probe', slug: {_type: 'slug', current: ALT_ID}})
  const {landed} = await lateChunk(page, t.docPath('post', ALT_ID), 'mainImage.alt')
  const alt = page.locator('[id="mainImage.alt"]')
  await alt.click({timeout: 5_000}) // gone on old code: it sat in the chunk's boundary
  await page.keyboard.type('Held ')
  await landed()
  await page.keyboard.type('and landed', {delay: 15})
  await expect(alt, 'every letter, across the chunk landing').toHaveValue('Held and landed')
  await expect(alt, 'the focus stayed in Alt').toBeFocused()
  await expect.poll(async () => ((await t.docValue(ALT_ID, 'mainImage')) as {alt?: string} | undefined)?.alt, {message: 'saved', timeout: 10_000}).toBe('Held and landed')
})

// A press held while the chunk is late fires as it lands only if the person is still on it: the same
// button, still focused, on the same document. Anything else since, and it is dropped (lib/held-act.ts).
test('a held Select and a held Upload are dropped once the person types in Title: no dialog, no chooser, every letter kept', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  await t.draftOnly(PRESS_ID, 'fieldTypes', {title: PRESS_TITLE})
  let choosers = 0
  page.on('filechooser', () => void choosers++)
  const {select, landed} = await lateChunk(page, t.docPath('fieldTypes', PRESS_ID))
  await page.clock.fastForward(2_000)
  await select.click({timeout: 2_000})
  await page.locator('.file-input').getByRole('button', {name: 'Upload'}).click({timeout: 2_000})
  const title = page.locator('[id="title"]')
  await title.click()
  await title.press('End')
  await page.keyboard.type(' held')
  await landed()
  await page.keyboard.type(' on', {delay: 15})
  await inputsLive(page)
  await expect.soft(page.getByRole('dialog'), 'no dialog: the person moved on from Select').toHaveCount(0)
  expect.soft(choosers, 'no file chooser: the person moved on from Upload').toBe(0)
  await expect.soft(title, 'Title keeps the focus').toBeFocused()
  await expect.soft(title, 'every letter, across the chunk landing').toHaveValue(`${PRESS_TITLE} held on`)
  await expect.soft.poll(() => t.docValue(PRESS_ID, 'title', 'fieldTypes'), {message: 'saved', timeout: 10_000}).toBe(`${PRESS_TITLE} held on`)
})

test('a Select held on one document opens nothing on the next one the person goes to', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  await t.draftOnly(PRESS_ID, 'fieldTypes', {title: PRESS_TITLE})
  const {select, landed} = await lateChunk(page, t.docPath(LATE.type, LATE.id))
  await page.clock.fastForward(2_000)
  await select.click({timeout: 2_000})
  // A client navigation (the list's link), the chunk still held: the other document draws its own photo field.
  await page.getByRole('link', {name: new RegExp(`^${PRESS_TITLE}`)}).first().click()
  await expect(page.locator('[id="title"]')).toHaveValue(PRESS_TITLE)
  await landed()
  await inputsLive(page)
  await expect(page.getByRole('dialog'), "no dialog on the other document: the press was the first one's").toHaveCount(0)
})

test('a held Select is dropped after a click elsewhere on the page', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  const {select, landed} = await lateChunk(page, t.docPath(LATE.type, LATE.id))
  await page.clock.fastForward(2_000)
  await select.click({timeout: 2_000})
  // A spot in the form that is nothing to press or type in.
  const spot = await page.evaluate(() => {
    const r = document.querySelector('.doc-form')!.getBoundingClientRect()
    for (let y = r.top + 4; y < Math.min(r.bottom, innerHeight); y += 8)
      for (let x = r.left + 2; x < r.right; x += 16) {
        const el = document.elementFromPoint(x, y)
        if (el && !el.closest('button, a, input, textarea, select, label, [tabindex], [contenteditable], [role]')) return {x, y}
      }
    return null
  })
  expect(spot, 'an empty spot in the form').not.toBeNull()
  await page.mouse.click(spot!.x, spot!.y)
  await landed()
  await inputsLive(page)
  await expect(page.getByRole('dialog'), 'no dialog: the person clicked elsewhere').toHaveCount(0)
})

// Guard (task-05dc): the chunk's boundaries on the server hold no control that takes typing.
// Typing into a server-drawn input of the chunk before it lands would have nowhere to go once the
// real input replaces it. No browser: the server's HTML only.
test("the editors chunk's server HTML holds no input that takes typing", async ({request}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  const typed = /<input\b(?![^>]*\btype="(?:hidden|file|checkbox|radio|button|submit|reset|range|color|image)")[^>]*>|<textarea\b|\bcontenteditable\b/gi
  let regions = 0
  const found: string[] = []
  for (const [type, id] of [['post', 'post-17'], [LATE.type, LATE.id]] as const) {
    const html = await (await request.get(t.docPath(type, id))).text()
    const form = html.slice(Math.max(0, html.indexOf('class="doc-form')))
    // The form's top-level Suspense regions (<!--$--> … <!--/$-->): the editors chunk's boundaries.
    let depth = 0
    let start = 0
    for (const m of form.matchAll(/<!--(\$\??!?|\/\$)-->/g)) {
      if (m[1] !== '/$') {
        if (depth++ === 0) start = m.index! + m[0].length
      } else if (depth > 0 && --depth === 0) {
        regions++
        for (const hit of form.slice(start, m.index).match(typed) ?? []) found.push(`${id}: ${hit.slice(0, 80)}`)
      }
    }
  }
  expect(regions, 'the pages drew chunk boundaries on the server').toBeGreaterThan(0)
  expect(found, 'no typing control inside them').toEqual([])
})
