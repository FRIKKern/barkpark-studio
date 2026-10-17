import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// The footer's "Last published N ago" is worked out on the server and again as the page
// hydrates; with the browser's clock days ahead the two differ. The hydrating render reads
// the server's time (lib/now.ts): no mismatch, no swap; the clock's 30 s tick brings the browser's.
test('footer: the relative publish time hydrates as the server rendered it', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: SSR')
  await t.prepare(page.context())
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  await page.clock.install({time: new Date(Date.now() + 3 * 86_400_000)})
  const path = t.docPath('post', 'post-01')
  const html = await (await page.request.get(path)).text()
  const ssr = /class="save-state-text"[^>]*>([^<]*)</.exec(html)?.[1]
  expect(ssr, 'the server rendered the footer').toMatch(/^Last published /)
  await page.goto(path)
  await t.settle(page)
  await expect(page.locator('.doc-footer .save-state-text').first()).toHaveText(ssr!)
  expect(errors.filter((e) => /hydrat|react\.dev\/errors\/4(18|19|20|21|22|23|24|25)/i.test(e))).toEqual([])
  await page.clock.fastForward(31_000)
  await expect(page.locator('.doc-footer .save-state-text').first()).toHaveText(/^Last published 3 days ago$/)
})
