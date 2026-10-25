import {expect, test} from '../rig/test'
import {target, closeAndSettle} from '../rig/targets'

// task-71cb73cb5f89acef (scout 8): an uploaded SVG opened at the studio's /api/media/<id>
// ran its script on the studio's origin, with the editor's session. The test uploads a
// harmless probe (it sets window.__scout8), opens it as a page, shows it as an <img>,
// and removes the asset after.
const scope = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const media = () => `${scope()}/v1/media/${process.env.BARKPARK_DATASET}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const NAME = `scout8-${Date.now().toString(36)}.svg`
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="window.__scout8=1"><script>window.__scout8=1</script><rect width="40" height="20" fill="#0a0"/><!-- ${NAME} --></svg>`
let asset: {id: string; url: string} | undefined
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name === 'studio' && asset) await fetch(`${media()}/${asset.id}`, {method: 'DELETE', headers: auth()})
})

test('@local an uploaded SVG opened from the studio runs no script, and still shows as an image', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our media proxy')
  await page.goto('/media')
  await t.settle(page)
  await page.locator('input[type=file]').setInputFiles({name: NAME, mimeType: 'image/svg+xml', buffer: Buffer.from(SVG)})
  await expect
    .poll(async () => {
      const found = (await (await fetch(`${media()}/search?q=${NAME}&limit=5`, {headers: auth()})).json()) as {result: {hits: {id: string; originalName?: string; url?: string}[]}}
      const hit = found.result.hits.find((h) => h.originalName === NAME)
      if (hit) asset = {id: hit.id, url: hit.url ?? ''}
      return !!hit
    }, {timeout: 15_000})
    .toBe(true)

  for (const path of [`/api/media/${asset!.id}`, new URL(asset!.url, process.env.BARKPARK_URL).pathname]) {
    if (!path.startsWith('/api/') && !path.startsWith('/w/')) continue
    // As an image: drawn.
    const drawn = await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode().catch(() => {})
      return img.naturalWidth
    }, path)
    expect(drawn, `${path} draws as an <img>`).toBeGreaterThan(0)
    // As a page: a download, and no script ran here.
    const download = page.waitForEvent('download', {timeout: 10_000})
    await page.goto(path).catch(() => {})
    await download
    expect(await page.evaluate(() => (window as {__scout8?: number}).__scout8), `${path} as a page`).toBeUndefined()
    // Asked for as an image: inline, under the sandbox CSP and nosniff.
    const res = await page.request.get(path, {headers: {'sec-fetch-dest': 'image'}})
    expect(res.status()).toBe(200)
    expect(res.headers()['content-security-policy']).toMatch(/sandbox/)
    expect(res.headers()['x-content-type-options']).toBe('nosniff')
    expect(res.headers()['content-disposition']).toBeUndefined()
  }
})
