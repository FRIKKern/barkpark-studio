import {expect, test} from '@playwright/test'
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
