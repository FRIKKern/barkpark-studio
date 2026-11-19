import {randomBytes} from 'node:crypto'
import {expect, test, type Page} from '../rig/test'
import {signInIfAsked, target, closeAndSettle} from '../rig/targets'

// A cancelled upload leaves no asset on Barkpark. The browser hands the studio server the
// whole file in a moment; Cancel comes while the server sends it on (progress at 100%),
// and Barkpark must end up without it (lib/upload-relay.ts). Cancels once left one each.
// In CI, on the production build: there the client's leaving was never heard
// (server/client-gone.ts), while the dev server passed.
const base = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
// The studio server's uploads, handled now and finished (GET /api/e2e-listen, STUDIO_E2E_HOOKS=1;
// app/src/server/upload-relays.ts); undefined with the hooks off.
const relays = async (page: Page) => {
  const r = await page.request.get('/api/e2e-listen')
  return r.ok() ? ((await r.json()) as {uploads?: {relaying: number; ended: number; sending: number}}).uploads : undefined
}
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
  const before = await relays(page)
  // 12 MB: some seconds from the studio server to Barkpark.
  await field.locator('input[type="file"]').setInputFiles({name, mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(12 * 1024 * 1024), Buffer.from('\n%%EOF\n')])})
  const card = field.getByRole('status', {name: `Uploading ${name}`})
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100', {timeout: 15_000})
  await card.getByRole('button', {name: 'Cancel'}).click()
  await expect(card).toBeHidden()
  try {
    // The server's part over: this upload's handler has ended, whatever it did (cut the send
    // off, or awaited Barkpark's answer and deleted what it made), and no send to Barkpark is
    // still open (one that went on regardless is waited out to its answer). That is all there
    // is to wait for: Barkpark parses a whole body before its upload handler runs, and makes
    // the asset before it answers, so a send cut off makes none, and one that went on has its
    // asset, and the relay's delete of it, done by the time `sending` is back to 0 (lib/upload-relay.ts).
    // Without the hooks: 4 s from the cancel, as before.
    if (before) {
      await expect.poll(async () => {
        const now = await relays(page)
        return !!now && now.ended > before.ended && now.relaying === 0 && now.sending === 0
      }, {message: 'the upload has ended on the studio server and on its way to Barkpark', timeout: 15_000}).toBe(true)
    } else await page.waitForTimeout(4000)
    expect(await named(name), 'no asset left on Barkpark').toEqual([])
  } finally {
    for (const a of await named(name)) await fetch(`${base()}/v1/media/${process.env.BARKPARK_DATASET}/${a.id}`, {method: 'DELETE', headers: auth()})
  }
})
