import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {bpMutate, target, closeAndSettle} from '../rig/targets'

// B08 (Barkpark-native, ours only), after LiveView's media library: the Media tool
// lists the dataset's assets; search and the visibility filter narrow them; an asset's
// checkout lock is taken and released ("Checked out by you"); its title saves to its
// mediaAsset document (Barkpark's PATCH); a folder is created, the asset filed into it
// and taken out. The test uploads its own image with the Upload button (the count goes
// up by one) and removes it, the folder and the lock after.
const scope = () => `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const media = () => `${scope()}/v1/media/${process.env.BARKPARK_DATASET}`
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})
const NAME = `b08-${Date.now().toString(36)}.png`
let asset: {id: string; docId: string} | undefined
let folder: string | undefined
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  if (target(info).name !== 'studio') return
  if (asset) {
    await fetch(`${media()}/${asset.id}/undo-checkout`, {method: 'POST', headers: auth()})
    await fetch(`${media()}/${asset.id}`, {method: 'DELETE', headers: auth()})
  }
  if (folder) await bpMutate([{delete: {id: folder, type: 'mediaCollection', force: true}}]).catch(() => {})
})

test('@local B08: media library — upload, count, search, visibility, checkout lock, title, folders', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: the reference is LiveView')
  test.setTimeout(45_000)
  await page.goto('/media')
  await t.settle(page)
  await expect(page.locator('.media-tile').first()).toBeVisible()
  // The count, as LiveView's "Showing 50 of 124 assets".
  const count = page.locator('.media-count')
  await expect(count).toHaveText(/^(Showing \d+ of \d+|\d+) assets$/)
  const before = Number((await count.innerText()).match(/(\d+) assets$/)![1])

  // Upload through the tool's button: a fresh asset of our own (byte-different, so a new one).
  const png = readFileSync(new URL('../../fixtures/assets/fixture-image.png', import.meta.url))
  await page.locator('input[type=file]').setInputFiles({name: NAME, mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from(NAME)])})
  await expect(count).toHaveText(new RegExp(`${before + 1} assets$`), {timeout: 15_000})
  await expect(page.getByRole('button', {name: 'Upload', exact: true})).toBeEnabled()
  const found = (await (await fetch(`${media()}/search?q=${NAME}&limit=5`, {headers: auth()})).json()) as {result: {hits: {id: string; assetDocId?: string; originalName?: string}[]}}
  const hit = found.result.hits.find((h) => h.originalName === NAME)!
  expect(hit, 'the upload is in the library').toBeTruthy()
  asset = {id: hit.id, docId: (hit.assetDocId ?? `asset-${hit.id}`).replace(/^drafts\./, '')}
  // Sort (LiveView's orderings): newest first puts the upload first; oldest first, Barkpark's oldest.
  await expect(page.locator('.media-tile').first()).toContainText(NAME)
  const oldest = (await (await fetch(`${media()}/search?limit=1&sort=created-asc`, {headers: auth()})).json()) as {result: {hits: {originalName?: string; filename?: string}[]}}
  await page.getByLabel('Sort').selectOption('created-asc')
  await expect(page.locator('.media-tile').first()).toContainText(oldest.result.hits[0]!.originalName ?? oldest.result.hits[0]!.filename!)
  await page.getByLabel('Sort').selectOption('created-desc')
  // List (LiveView's): name, kind, format, size; a row opens the asset as a tile does.
  await page.getByRole('button', {name: 'List', exact: true}).click()
  const listRow = page.locator('.media-list tbody tr', {hasText: NAME})
  await expect(listRow.locator('td')).toHaveText([NAME, 'image', 'image/png', /\d+ kB/])
  await listRow.getByRole('button').click()
  await expect(page.getByRole('complementary', {name: 'Asset'}).getByRole('heading', {name: NAME})).toBeVisible()
  await page.getByRole('button', {name: 'Close asset'}).click()
  await page.getByRole('button', {name: 'Grid', exact: true}).click()

  await page.getByRole('searchbox', {name: 'Search media'}).fill(NAME)
  const tile = page.locator('.media-tile', {hasText: NAME})
  await expect(tile).toHaveCount(1)
  await page.getByLabel('Visibility').selectOption('private')
  await expect(tile).toHaveCount(0) // uploads are public
  await page.getByLabel('Visibility').selectOption('public')
  await expect(tile).toHaveCount(1)
  // The kind filter (LiveView's library list): a png is an image, never a document; each
  // kind's count is Barkpark's.
  const kinds = page.getByRole('navigation', {name: 'Folders'})
  await kinds.getByRole('button', {name: /^Documents/}).click()
  await expect(tile).toHaveCount(0)
  await kinds.getByRole('button', {name: /^Images/}).click()
  await expect(tile).toHaveCount(1)
  const facet = (await (await fetch(`${media()}/search?limit=1&facets=kind&q=${NAME}&facet.visibility=public`, {headers: auth()})).json()) as {result: {facets: {kind: {value: string; count: number}[]}}}
  await expect(kinds.getByRole('button', {name: /^Images/})).toHaveText(`Images${facet.result.facets.kind.find((k) => k.value === 'image')!.count}`)
  await kinds.getByRole('button', {name: /^All media/}).click()

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

  // Filing: the asset goes into the folder, shows there, and comes out again.
  await page.getByRole('navigation', {name: 'Folders'}).getByRole('button', {name: 'All media'}).click()
  await page.getByRole('searchbox', {name: 'Search media'}).fill(NAME)
  await tile.click()
  await inspector.getByLabel('Add to folder').selectOption({label: 'B08 folder'})
  await expect(page.getByText('Added to the folder')).toBeVisible()
  await page.getByRole('searchbox', {name: 'Search media'}).fill('')
  await row.click()
  await expect(tile).toHaveCount(1)
  await page.screenshot({path: 'evidence/B08-3-filed-studio.png'})
  await tile.click()
  await inspector.getByRole('button', {name: 'Remove from this folder'}).click()
  await expect(page.getByText('This folder is empty')).toBeVisible()
})
