import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {bpMutate, target} from '../rig/targets'

// J36, Sanity's asset Delete: an image a document uses can't be deleted. The dialog
// says so and lists the document (found through Barkpark's backlinks, #22042), and the
// studio's DELETE refuses it too. Once nothing uses it, Delete asks and deletes it.
// The test uploads its own image, gives post-07's draft to it, and cleans up after.
const ID = 'post-07'
const media = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/media/${process.env.BARKPARK_DATASET}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const NAME = `j36-delete-${Date.now().toString(36)}.png`
let asset: string | undefined
test.afterEach(async ({}, info) => {
  if (target(info).name !== 'studio') return
  await bpMutate([{discardDraft: {id: ID, type: 'post'}}]).catch(() => {})
  if (asset) await fetch(`${media()}/${asset}`, {method: 'DELETE', headers: auth()})
})

test('@local J36: an image in use cannot be deleted; unused, Delete asks and deletes it', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; Sanity is the reference by hand')
  const png = readFileSync(new URL('../../fixtures/assets/fixture-image.png', import.meta.url))
  const body = new FormData()
  body.append('file', new Blob([png, new TextEncoder().encode(NAME)], {type: 'image/png'}), NAME)
  const up = await fetch(`${media()}/upload`, {method: 'POST', headers: auth(), body})
  expect(up.ok, `upload ${up.status}`).toBe(true)
  asset = ((await up.json()) as {result: {id: string}}).result.id
  await bpMutate([{patch: {id: ID, type: 'post', set: {mainImage: {_type: 'image', asset: {_type: 'reference', _ref: `asset-${asset}`}}}}}])

  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const field = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
  const openDelete = async () => {
    await field.getByRole('button', {name: 'Open image options menu'}).click()
    await page.getByRole('menuitem', {name: 'Select'}).click()
    const library = page.getByRole('dialog', {name: /^Select image for/})
    await library.getByRole('button', {name: `${NAME}: more`}).click()
    await page.getByRole('menuitem', {name: 'Delete'}).click()
    return {library, dialog: page.getByRole('dialog', {name: 'Delete image'})}
  }

  // In use: the warning and the document, no Delete; the studio's DELETE refuses it.
  let {library, dialog} = await openDelete()
  await expect(dialog.getByRole('alert')).toContainText(`${NAME} cannot be deleted because it's being used`)
  await expect(dialog.locator('.usage-list li')).toHaveCount(1)
  await expect(dialog.locator('.usage-list')).toContainText('Fixture post 07')
  await expect(dialog.getByRole('button', {name: 'Delete'})).toHaveCount(0)
  expect((await page.request.delete(`/api/media/${asset}`)).status()).toBe(409)
  await dialog.getByRole('button', {name: 'Cancel'}).click()
  await library.getByRole('button', {name: 'Close dialog'}).click()

  // Unused (the draft that used it is gone): Delete asks, then the asset is gone.
  await bpMutate([{discardDraft: {id: ID, type: 'post'}}])
  await expect(async () => {
    await page.reload()
    await t.settle(page)
    await expect(field.getByRole('button', {name: 'Select'})).toBeVisible({timeout: 2_000})
  }).toPass({timeout: 15_000})
  // The published post has no image: the empty field's Select opens the library.
  await field.getByRole('button', {name: 'Select'}).click()
  library = page.getByRole('dialog', {name: /^Select image for/})
  await library.getByRole('button', {name: `${NAME}: more`}).click()
  await page.getByRole('menuitem', {name: 'Delete'}).click()
  await expect(dialog).toContainText(`You are about to delete the image ${NAME} and its metadata. Are you sure?`)
  await dialog.getByRole('button', {name: 'Delete'}).click()
  await expect(page.getByText('Image was deleted')).toBeVisible()
  await expect.poll(async () => (await fetch(`${media()}/${asset}`, {headers: auth()})).status, {timeout: 10_000}).toBe(404)
  asset = undefined
})
