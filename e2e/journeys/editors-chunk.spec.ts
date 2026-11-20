import {expect, test, type Page} from '../rig/test'
import {bpMutate, bpRemove, closeAndSettle, target} from '../rig/targets'

// J20: the document editors' chunk (image/file inputs, body, Review changes) is fetched
// after the desk renders. Offline before it lands, the pane went to "Could not render the
// document editor" and stayed there until a reload (2026-10-11 sign-off pack). Now the
// rest of the form types on, and the inputs come once the chunk can be fetched.
// task-b2c0f7c946f9ea5f: an image's Alt typed while the chunk is still not here (the page hydrated
// without it) is saved as the draft once it lands. Before #1337 Alt sat inside the chunk's boundary and
// was gone by then. (Keys typed before hydration are early-typing.spec's.) On its own post
// (early-typing.spec's door: a fixed id, replaced at the start, removed and checked gone after). The 1.5 s hydration cap and the chunk's 1 s retry
// (DocEditors.tsx RETRY_MS) are passed on a fake clock, so no real second is spent on either.
const TYPED = {id: 'post-typed-landing', alt: 'Typed before it landed'} as const
test('J20: the editors chunk failing to load waits, and lands once it can', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  await bpMutate([{createOrReplace: {_id: TYPED.id, _type: 'post', title: 'Typed before the landing'}}])
  try {
    let blocked = true
    await page.route(/doc-editors/, (route) => (blocked ? route.abort('internetdisconnected') : route.continue()))
    await page.clock.install()
    await page.goto(t.docPath('post', TYPED.id))
    await page.clock.fastForward(1_600) // past the hydration cap: the page hydrates without the chunk
    await t.settle(page)
    const image = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
    await expect(t.field(page, 'title')).toBeEditable()
    await expect(page.getByText('Could not render the document editor')).toHaveCount(0)
    const alt = t.field(page, 'mainImage.alt')
    await expect.soft(alt, 'Alt is there to type into while the chunk is not').toBeEditable({timeout: 2_000})
    // Bounded: an Alt that is gone (or goes) as the click lands is a red row by name, not a timeout.
    if (await alt.click({timeout: 2_000}).then(() => true, () => false)) await page.keyboard.type(TYPED.alt, {delay: 20})
    blocked = false
    await page.clock.fastForward(1_000) // the chunk's next try (RETRY_MS)
    await expect(image.getByRole('button', {name: 'Upload'})).toBeVisible({timeout: 5_000})
    await expect(page.getByText('Could not render the document editor')).toHaveCount(0)
    await page.clock.resume() // real time again: the form's saves
    await expect.soft(alt, 'Alt typed before the landing is still on screen').toHaveValue(TYPED.alt)
    await expect
      .poll(async () => ((await t.docValue(TYPED.id, 'mainImage')) as {alt?: string} | undefined)?.alt, {message: 'the draft saved with the Alt typed before the landing', timeout: 10_000})
      .toBe(TYPED.alt)
  } finally {
    // Closed first: a save still on its way would write the draft again after the delete.
    await page.clock.resume().catch(() => {})
    await closeAndSettle(page)
    await bpRemove(TYPED.id, 'post')
  }
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
// No browser: the server's answer only.
test('J36: a document page preloads the editors chunk (production build)', async ({request}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio' || !(process.env.CI || process.env.E2E_PROD), 'the production server only (dev has no build manifest)')
  const res = await request.get(t.docPath('post', 'post-17'), {maxRedirects: 0})
  expect(res.headers().link).toMatch(/\/assets\/doc-editors-[\w-]+\.js>; rel=modulepreload/)
})

// task-05dcdef359da08fc: the page hydrates without the editors chunk once it is 1.5 s late
// (client.tsx). The chunk's server-drawn inputs (image and file: field-types-01 has both; the
// body canvas is drawn static, outside the chunk) stay drawn from the first paint until it lands,
// however late, and a click or a drop on them meanwhile is held or kept from the browser. The
// cap is passed on a fake clock, so no real second is spent near it.
const LATE = {type: 'fieldTypes', id: 'field-types-01'} as const
async function lateChunk(page: Page, docPath: string, beforeHydration: () => Promise<boolean>) {
  await page.addInitScript(() => {
    type Slot = {parent: Element; others: number; name: string}
    const w = window as {__slots?: Slot[]; __emptied?: string[]; __chunkIn?: boolean}
    w.__emptied = []
    // Each server-drawn Suspense boundary in the form (React marks it <!--$--> … <!--/$-->), named
    // by its field (the file input sits in no fieldset: by its class), with its parent's elements
    // outside it: "empty" is the parent holding only those.
    // Read once the server's HTML is parsed (DOMContentLoaded: a boundary still streaming in is not
    // there before), and before React can swap any (it hydrates after the page's deferred scripts).
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
      if (w.__chunkIn) return
      for (const s of w.__slots ?? []) if ((!s.parent.isConnected || s.parent.childElementCount <= s.others) && !w.__emptied!.includes(s.name)) w.__emptied!.push(s.name)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', find, {once: true})
    else find()
    new MutationObserver(check).observe(document, {subtree: true, childList: true})
  })
  let release!: () => void
  const late = new Promise<void>((r) => (release = r))
  await page.route(/doc-editors/, async (route) => (await late, route.continue()))
  await page.clock.install()
  const response = await page.goto(docPath, {waitUntil: 'commit'})
  await expect(page.locator('fieldset.field').filter({has: page.locator('[id="photo"]')}).getByRole('button', {name: 'Select'})).toBeVisible()
  const heldDrop = await beforeHydration()
  // Past the hydration cap: the page hydrates without the chunk, and the form's first updates run (the
  // comments' answer, task-05dc: it changes a context above the chunk's boundaries) and draw the boxes.
  await page.clock.fastForward(1_600)
  // Only until React has drawn the drop zone in the server's place: the chunk can then land inside the
  // hold React keeps on a fallback it just drew (some 300 ms).
  const drawnBox = () => page.evaluate(() => Object.keys(document.querySelector('.file-input .file-box') ?? {}).some((k) => k.startsWith('__reactProps')))
  await expect.poll(drawnBox, {message: 'React drew the drop zone', timeout: 10_000, intervals: [5]}).toBe(true)
  /** Lets the chunk in (the page marks the landing itself, so no round trip comes before it). */
  const letGo = async () => (release(), await page.clock.resume())
  return {letGo, heldDrop, html: () => response!.text()}
}

/** Guard (task-05dc): the chunk's boundaries in a page's server HTML hold no control that takes typing: typing there
 *  before the chunk lands would have nowhere to go once the real input replaces it. Read from the row's own page. */
function typingInBoundaries(html: string) {
  const typed = /<input\b(?![^>]*\btype="(?:hidden|file|checkbox|radio|button|submit|reset|range|color|image)")[^>]*>|<textarea\b|\bcontenteditable\b/gi
  const form = html.slice(Math.max(0, html.indexOf('class="doc-form')))
  let regions = 0
  let depth = 0
  let start = 0
  const found: string[] = []
  // The form's top-level Suspense regions (<!--$--> … <!--/$-->): the editors chunk's boundaries.
  for (const m of form.matchAll(/<!--(\$\??!?|\/\$)-->/g)) {
    if (m[1] !== '/$') {
      if (depth++ === 0) start = m.index! + m[0].length
    } else if (depth > 0 && --depth === 0) {
      regions++
      for (const hit of form.slice(start, m.index).match(typed) ?? []) found.push(hit.slice(0, 80))
    }
  }
  return {regions, found}
}

// One page load, one held chunk: the inputs stay drawn, and a drop on them is kept from the tab. The chunk
// lands just after React drew the boxes, inside the hold React keeps on a fallback it just drew (some 300 ms):
// a drop in every frame before the real input commits is still kept from the tab (the guard once stood down
// as the chunk loaded, review of #1337, P7b), and a focused Select keeps the focus on the live box. Each
// check is soft and named, so a red run says which of them broke.
test('a field group keeps its inputs drawn while the editors chunk is late; no drop gets through before or as it lands; the focus stays on Select', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  // A drop on the server-drawn box, once the page's guard is listening (before hydration).
  const kept = (type: string) =>
    page.evaluate((type) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File(['x'], 'kept.txt', {type: 'text/plain'}))
      const e = new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer})
      document.querySelector('.file-input .file-box')?.dispatchEvent(e)
      return e.defaultPrevented
    }, type)
  const {letGo, heldDrop, html} = await lateChunk(page, t.docPath(LATE.type, LATE.id), async () => {
    await expect.poll(() => kept('dragover'), {message: 'the guard is listening', timeout: 5_000, intervals: [10]}).toBe(true)
    return kept('drop')
  })
  // One call, no round trip before the chunk is let go: Select focused (not pressed), the landing marked,
  // and a dragover on the drop zone each frame from now until 500 ms on.
  const {slots, emptied} = await page.evaluate(() => {
    const w = window as {__frames?: Promise<boolean[]>; __chunkIn?: boolean; __slots?: {name: string}[]; __emptied?: string[]}
    document.querySelector<HTMLElement>('[id="photo"] [data-act="select"]')?.focus()
    const over = (el: Element) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File(['x'], 'kept.txt', {type: 'text/plain'}))
      const e = new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer})
      el.dispatchEvent(e)
      return e.defaultPrevented
    }
    const end = performance.now() + 500
    w.__frames = new Promise((done) => {
      const seen: boolean[] = []
      const tick = () => {
        const zone = document.querySelector('.file-input .file-box')
        if (zone) seen.push(over(zone))
        if (performance.now() > end) done(seen)
        else requestAnimationFrame(tick)
      }
      tick()
    })
    w.__chunkIn = true
    return {slots: (w.__slots ?? []).map((s) => s.name).sort(), emptied: w.__emptied ?? []}
  })
  await letGo()
  const frames = await page.evaluate(() => (window as {__frames?: Promise<boolean[]>}).__frames!)
  console.log(`late chunk: server boundaries ${JSON.stringify(slots)}; emptied before it landed ${JSON.stringify(emptied)}; drop kept ${heldDrop}; frames ${frames.length}, let through ${frames.filter((x) => !x).length}`)
  expect.soft(slots, "the server drew the chunk's inputs").toEqual(['file-input', 'photo'])
  expect.soft(emptied, 'no input went missing before the chunk landed').toEqual([])
  expect.soft(heldDrop, 'a drop while the chunk is late is kept from the browser').toBe(true)
  expect.soft(frames.length, 'frames probed as the chunk lands').toBeGreaterThan(10)
  expect.soft(frames.filter((x) => !x).length, 'frames as the chunk lands where a drop would have opened the file').toBe(0)
  await expect.soft(page.locator('[id="photo"] [data-act="select"]'), 'the live Select has the focus').toBeFocused()
  await expect.soft(page.getByRole('dialog'), 'focused only: nothing opens').toHaveCount(0)
  expect.soft(typingInBoundaries(await html()), "the page's chunk boundaries hold no typing control").toEqual({regions: 2, found: []})
})
