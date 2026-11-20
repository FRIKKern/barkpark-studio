import {expect, test} from '../rig/test'
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
// (client.tsx). The server-drawn inputs in the chunk's boundaries (image, file, body canvas)
// stay drawn from the first paint until it lands, however late. The cap is passed on a fake
// clock, so no real second is spent near it.
test('a field group keeps its inputs drawn while the editors chunk is late', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', "ours: the chunk is this studio's")
  await page.addInitScript(() => {
    type Slot = {parent: Element; others: number; name: string}
    const w = window as {__slots?: Slot[]; __emptied?: string[]; __chunkIn?: boolean}
    w.__emptied = []
    // Each server-drawn Suspense boundary in the form (React marks it <!--$--> … <!--/$-->):
    // its parent's elements outside it, so "empty" is the parent holding only those.
    const find = () => {
      const form = document.querySelector('.doc-form')
      if (!form || w.__slots) return
      const slots: Slot[] = []
      const walk = document.createTreeWalker(form, NodeFilter.SHOW_COMMENT)
      for (let c = walk.nextNode(); c; c = walk.nextNode()) {
        if ((c as Comment).data !== '$' || !c.parentElement || slots.some((s) => s.parent.contains(c!.parentElement))) continue
        let inside = 0
        for (let n = c.nextSibling; n && !(n.nodeType === 8 && (n as Comment).data === '/$'); n = n.nextSibling) if (n.nodeType === 1) inside++
        if (!inside) continue
        const name = c.parentElement.closest('fieldset, [id]')?.querySelector('[id]')?.id ?? c.parentElement.closest('[id]')?.id ?? '?'
        slots.push({parent: c.parentElement, others: c.parentElement.childElementCount - inside, name})
      }
      w.__slots = slots
    }
    const check = () => {
      find()
      if (w.__chunkIn) return
      for (const s of w.__slots ?? []) if (!s.parent.isConnected || s.parent.childElementCount <= s.others) w.__emptied!.includes(s.name) || w.__emptied!.push(s.name)
    }
    new MutationObserver(check).observe(document, {subtree: true, childList: true})
  })
  let release!: () => void
  const late = new Promise<void>((r) => (release = r))
  await page.route(/doc-editors/, async (route) => (await late, route.continue()))
  await page.clock.install()
  await page.goto(t.docPath('post', 'post-17'), {waitUntil: 'commit'})
  const select = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')}).getByRole('button', {name: 'Select'})
  await expect(select).toBeVisible()
  const slots = await page.evaluate(() => ((window as {__slots?: {name: string}[]}).__slots ?? []).map((s) => s.name))
  // Past the hydration cap: the page hydrates without the chunk, and the form's first updates run.
  await page.clock.fastForward(1_600)
  await expect(page.locator('html[data-hydrated]')).toBeAttached({timeout: 10_000})
  await expect(t.field(page, 'title')).toBeEditable()
  await page.waitForTimeout(300) // a few real frames for the form's first updates
  const emptied = await page.evaluate(() => (window as {__emptied?: string[]}).__emptied ?? [])
  await page.evaluate(() => void ((window as {__chunkIn?: boolean}).__chunkIn = true))
  release()
  console.log(`late chunk: server boundaries ${JSON.stringify(slots)}; emptied before it landed ${JSON.stringify(emptied)}`)
  expect(slots.length, 'the server drew the chunk boundaries').toBeGreaterThan(0)
  expect(emptied, 'no boundary went empty before the chunk landed').toEqual([])
  await select.click()
  await expect(page.getByRole('dialog')).toBeVisible({timeout: 5_000})
})
