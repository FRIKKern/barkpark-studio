import {randomBytes} from 'node:crypto'
import {expect, test} from '@playwright/test'
import {signInIfAsked, target, closeAndSettle} from '../rig/targets'

// A cancelled upload leaves no asset on Barkpark. The browser hands the studio server the
// whole file in a moment; Cancel comes while the server sends it on (progress at 100%),
// and Barkpark must end up without it (lib/upload-relay.ts). Cancels once left one each.
// In CI, on the production build: there the client's leaving was never heard
// (server/client-gone.ts), while the dev server passed.
const base = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const named = async (name: string) =>
  ((await (await fetch(`${base()}/v1/media/${process.env.BARKPARK_DATASET}?limit=50`, {headers: auth()})).json()) as {result: {assets: {id: string; originalName?: string}[]}}).result.assets.filter((a) => a.originalName === name)

test.afterEach(async ({page}) => closeAndSettle(page))

test('J54: a cancelled upload leaves no asset on Barkpark', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our upload relay')
  test.setTimeout(60_000)
  const name = `cancel-${Date.now()}.pdf`
  await t.prepare(page.context())
  await page.goto(t.docPath('post', 'post-03'))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  const field = page.locator('.field').filter({has: page.locator('.file-input')}).last()
  // 12 MB: some seconds from the studio server to Barkpark.
  await field.locator('input[type="file"]').setInputFiles({name, mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(12 * 1024 * 1024), Buffer.from('\n%%EOF\n')])})
  const card = field.getByRole('status', {name: `Uploading ${name}`})
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100', {timeout: 15_000})
  await card.getByRole('button', {name: 'Cancel'}).click()
  await expect(card).toBeHidden()
  try {
    // Long enough for Barkpark to have taken it, had it gone on (it answers in 0.6-1.4 s).
    await page.waitForTimeout(4000)
    expect(await named(name), 'no asset left on Barkpark').toEqual([])
  } finally {
    for (const a of await named(name)) await fetch(`${base()}/v1/media/${process.env.BARKPARK_DATASET}/${a.id}`, {method: 'DELETE', headers: auth()})
  }
})
