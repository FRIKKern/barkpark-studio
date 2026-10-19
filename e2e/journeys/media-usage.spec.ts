import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {bpMutate, target, closeAndSettle} from '../rig/targets'

// B08 + J36 (ours only: LiveView's library has neither): the Media tool's asset shows the
// documents using it, and Delete is the image field's (Sanity's) dialog — an asset in use
// can't be deleted and says where it is used; unused, it is deleted and leaves the library.
// A scratch image and a scratch post, both removed after.
const scope = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const media = () => `${scope()}/v1/media/${process.env.BARKPARK_DATASET}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const NAME = `usage-${Date.now().toString(36)}.png`
const POST = `post-usage-${Date.now().toString(36)}`
let asset: string | undefined
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name !== 'studio') return
  await bpMutate([{delete: {id: POST, type: 'post', force: true}}]).catch(() => {})
  if (asset) await fetch(`${media()}/${asset}`, {method: 'DELETE', headers: auth()})
})

test('@local B08: an asset lists the documents using it; in use it is not deleted, unused it is', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: the reference is LiveView')
  test.setTimeout(60_000)
  await page.goto('/media')
  await t.settle(page)
  const png = readFileSync(new URL('../../fixtures/assets/fixture-image.png', import.meta.url))
  await page.locator('input[type=file]').setInputFiles({name: NAME, mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from(NAME)])})
  await expect(page.locator('.media-tile').first()).toContainText(NAME, {timeout: 15_000})
  const found = (await (await fetch(`${media()}/search?q=${NAME}&limit=5`, {headers: auth()})).json()) as {result: {hits: {id: string; originalName?: string}[]}}
  asset = found.result.hits.find((h) => h.originalName === NAME)!.id
  await bpMutate([{createOrReplace: {_id: POST, _type: 'post', title: `Uses ${NAME}`, mainImage: {_type: 'image', asset: {_type: 'reference', _ref: `asset-${asset}`}}}}, {publish: {id: POST, type: 'post'}}])

  // In use: listed, and Delete refuses with the place it is used.
  const inspector = page.getByRole('complementary', {name: 'Asset'})
  const usedBy = inspector.getByRole('region', {name: 'Documents using file'})
  await expect.poll(async () => {
    await page.locator('.media-tile', {hasText: NAME}).click()
    return usedBy.getByText(`Uses ${NAME}`).count()
  }, {timeout: 20_000}).toBeGreaterThan(0)
  await inspector.getByRole('button', {name: 'Delete', exact: true}).click()
  const dialog = page.getByRole('dialog', {name: 'Delete image'})
  await expect(dialog.getByRole('alert')).toContainText(`${NAME} cannot be deleted because it's being used`)
  await expect(dialog).toContainText(`Uses ${NAME}`)
  await page.keyboard.press('Escape')

  // Unused: it asks, deletes, and the asset leaves the library.
  await bpMutate([{delete: {id: POST, type: 'post', force: true}}])
  await page.reload()
  await t.settle(page)
  await expect.poll(async () => {
    await page.locator('.media-tile', {hasText: NAME}).click()
    return usedBy.getByText('No documents are using file').count()
  }, {timeout: 20_000}).toBeGreaterThan(0)
  await inspector.getByRole('button', {name: 'Delete', exact: true}).click()
  await expect(dialog).toContainText(`You are about to delete the image ${NAME} and its metadata. Are you sure?`)
  await dialog.getByRole('button', {name: 'Delete', exact: true}).click()
  await expect(inspector).toBeHidden()
  await expect(page.locator('.media-tile', {hasText: NAME})).toHaveCount(0)
  asset = undefined
})
