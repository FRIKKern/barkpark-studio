import {expect, test} from '../rig/test'
import {target} from '../rig/targets'

// SSR text must hydrate as the server rendered it when the browser's clock and zone are not
// the server's: here UTC+14, three days ahead. Each mismatch this guards was a React #418
// that regenerated its tree: the footer's "Last published N ago" (it reads the server's time
// until the clock's 30 s tick, lib/now.ts), Vision's dated API version, the date field's
// example, the Releases calendar's today and day names.
test.use({timezoneId: 'Pacific/Kiritimati'})
test('hydration: the footer, list, a date field, Vision and Releases hydrate as rendered in another zone and day', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: SSR')
  await t.prepare(page.context())
  await page.clock.install({time: new Date(Date.now() + 3 * 86_400_000)})
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  const mismatches = () => errors.filter((e) => /hydrat|react\.dev\/errors\/4(18|19|20|21|22|23|24|25)/i.test(e))
  // The footer: the words this very page load's HTML carries (a second request would be seconds later).
  const html = await (await page.goto(t.docPath('post', 'post-01')))!.text()
  const ssr = /class="save-state-text"[^>]*>([^<]*)</.exec(html)?.[1]
  expect(ssr, 'the server rendered the footer').toMatch(/^Last published /)
  await t.settle(page)
  await expect(page.locator('.doc-footer .save-state-text').first()).toHaveText(ssr!)
  expect(mismatches()).toEqual([])
  await page.clock.fastForward(31_000)
  await expect(page.locator('.doc-footer .save-state-text').first()).toHaveText(/^Last published 3 days ago$/)
  // Over a week the words turn: last week, then (from a month) the date, read on this browser's
  // calendar (UTC+14) once hydrated, and UTC while it hydrates (lib/now.ts useZone): no mismatch.
  await page.clock.setSystemTime(new Date(Date.now() + 45 * 86_400_000))
  await page.clock.fastForward(31_000)
  const published = await page.locator('.doc-footer .save-state-text').first().textContent()
  const day = /^Last published ([A-Z][a-z]{2} \d{1,2})$/.exec(published ?? '')?.[1]
  expect(day, `a date, not ${published}`).toBeTruthy()
  expect(mismatches()).toEqual([])
  for (const path of [t.listPath('post'), t.docPath('fieldTypes', 'field-types-01'), '/vision', '/releases']) {
    await page.goto(path)
    await t.settle(page)
    await page.waitForTimeout(300)
    expect(mismatches(), path).toEqual([])
  }
})
