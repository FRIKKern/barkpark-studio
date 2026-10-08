import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {bpMutate, target} from '../rig/targets'

// B08 (Barkpark-native, ours only), after LiveView's media library: the Media tool
// lists the dataset's assets; search and the visibility filter narrow them; an asset's
// checkout lock is taken and released ("Checked out by you"); its title saves to its
// mediaAsset document; a folder is created. The test uploads its own image and removes
// it, the folder and the lock after. (Filing into a folder: task-8ddfc18c98283581.)
const scope = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const media = () => `${scope()}/v1/media/${process.env.BARKPARK_DATASET}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const NAME = `b08-${Date.now().toString(36)}.png`
let asset: {id: string; docId: string} | undefined
let folder: string | undefined
test.afterEach(async ({}, info) => {
  if (target(info).name !== 'studio') return
  if (asset) {
    await fetch(`${media()}/${asset.id}/undo-checkout`, {method: 'POST', headers: auth()})
    await fetch(`${media()}/${asset.id}`, {method: 'DELETE', headers: auth()})
  }
  if (folder) await bpMutate([{delete: {id: folder, type: 'mediaCollection', force: true}}]).catch(() => {})
})

test('@local B08: media library — search, visibility, checkout lock, title, folders', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: the reference is LiveView')
  test.setTimeout(45_000)
  // A fresh asset of our own (byte-different, so it is a new one).
  const png = readFileSync(new URL('../../fixtures/assets/fixture-image.png', import.meta.url))
  const body = new FormData()
  body.append('file', new Blob([png, new TextEncoder().encode(NAME)], {type: 'image/png'}), NAME)
  const up = await fetch(`${media()}/upload`, {method: 'POST', headers: auth(), body})
  expect(up.ok, `upload ${up.status}`).toBe(true)
  const {result} = (await up.json()) as {result: {id: string; assetDocId?: string}}
  asset = {id: result.id, docId: (result.assetDocId ?? `asset-${result.id}`).replace(/^drafts\./, '')}

  await page.goto('/media')
  await t.settle(page)
  await expect(page.locator('.media-tile').first()).toBeVisible()
  await page.getByRole('searchbox', {name: 'Search media'}).fill(NAME)
  const tile = page.locator('.media-tile', {hasText: NAME})
  await expect(tile).toHaveCount(1)
  await page.getByLabel('Visibility').selectOption('private')
  await expect(tile).toHaveCount(0) // uploads are public
  await page.getByLabel('Visibility').selectOption('public')
  await expect(tile).toHaveCount(1)

  await tile.click()
  const inspector = page.getByRole('complementary', {name: 'Asset'})
  await expect(inspector.getByRole('heading', {name: NAME})).toBeVisible()
  await expect(inspector.getByText('Public — within this scope')).toBeVisible()
  await inspector.getByRole('button', {name: 'Check out'}).click()
  await expect(inspector.getByRole('status')).toHaveText('Checked out by you')
  await expect(tile).toContainText('Locked')
  await inspector.getByLabel('Title').fill('Titled in the media tool')
  await inspector.getByRole('button', {name: 'Save'}).click()
  await expect
    .poll(async () => ((await (await fetch(`${media()}/${asset!.id}`, {headers: auth()})).json()) as {result: {asset?: {title?: string}}}).result.asset?.title, {timeout: 10_000})
    .toBe('Titled in the media tool')
  await page.screenshot({path: 'evidence/B08-1-inspector-studio.png'})
  await inspector.getByRole('button', {name: 'Release'}).click()
  await expect(inspector.getByRole('status')).toContainText('Not checked out')

  await page.getByRole('button', {name: '+ New folder'}).click()
  await page.getByLabel('Folder name').fill('B08 folder')
  await page.getByRole('button', {name: 'Create', exact: true}).click()
  const row = page.getByRole('navigation', {name: 'Folders'}).getByRole('button', {name: 'B08 folder'})
  await expect(row).toHaveAttribute('aria-current', 'true')
  const list = (await (await fetch(`${media()}/collections?limit=100`, {headers: auth()})).json()) as {result: {collections: {id: string; title: string}[]}}
  folder = list.result.collections.find((c) => c.title === 'B08 folder')?.id
  expect(folder).toBeTruthy()
  await page.getByRole('searchbox', {name: 'Search media'}).fill('')
  await page.getByLabel('Visibility').selectOption('')
  await expect(page.getByText('This folder is empty')).toBeVisible()
  await page.screenshot({path: 'evidence/B08-2-folder-studio.png'})
})
