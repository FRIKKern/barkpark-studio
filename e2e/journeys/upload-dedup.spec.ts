import {randomBytes} from 'node:crypto'
import {expect, test} from '@playwright/test'
import {signInIfAsked, target, closeAndSettle} from '../rig/targets'

// The same bytes give one asset (Barkpark #22700), and the second time nothing is sent:
// the studio hashes the file first and uses the asset with that SHA-1, as Sanity does.
const ID = 'post-03'
const base = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const named = async (name: string) =>
  ((await (await fetch(`${base()}/v1/media/${process.env.BARKPARK_DATASET}?limit=50`, {headers: auth()})).json()) as {result: {assets: {id: string; originalName?: string}[]}}).result.assets.filter((a) => a.originalName === name)

test.afterEach(async ({page}, info) => (await closeAndSettle(page), await target(info).restore(ID, {title: 'Fixture post 03'})))

test('@local J54: the same file twice is one asset, and the second time nothing is sent', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'our upload')
  const name = `dedup-${Date.now()}.pdf`
  const file = {name, mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(200_000), Buffer.from('\n%%EOF\n')])}
  const before = await t.docValue(ID, 'attachment')
  const sends: string[] = []
  page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/media/upload') && sends.push(r.url()))
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('tab', {name: 'Meta'}).click()
  const field = page.locator('.field').filter({has: page.locator('.file-input')}).last()
  const ref = () => t.docValue(ID, 'attachment').then((v) => (v as {asset?: {_ref?: string}} | undefined)?.asset?._ref)
  try {
    await field.locator('input[type="file"]').setInputFiles(file)
    await expect(field.getByText(name)).toBeVisible({timeout: 20_000})
    await expect.poll(ref, {timeout: 10_000}).toMatch(/^asset-/)
    const first = await ref()
    expect(sends, 'the first time it is sent').toHaveLength(1)

    await field.getByRole('button', {name: 'Open file options menu'}).click()
    await page.getByRole('menuitem', {name: 'Clear field'}).click()
    await expect(field.getByText(name)).toBeHidden()
    await field.locator('input[type="file"]').setInputFiles(file)
    await expect(field.getByText(name)).toBeVisible({timeout: 20_000})
    await expect.poll(ref, {timeout: 10_000}).toBe(first)
    expect(sends, 'the second time nothing is sent').toHaveLength(1)
    expect(await named(name), 'one asset on Barkpark').toHaveLength(1)
  } finally {
    await t.restore(ID, {title: 'Fixture post 03', attachment: before})
    for (const a of await named(name)) await fetch(`${base()}/v1/media/${process.env.BARKPARK_DATASET}/${a.id}`, {method: 'DELETE', headers: auth()})
  }
})
