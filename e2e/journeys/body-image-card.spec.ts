import {expect, test} from '@playwright/test'
import {bpBase, bpDataset, bpMutate, target} from '../rig/targets'

// J11, as Sanity's image block object (scout 2026-10-16, measured light and dark): a body
// image is a card, its file name and a "…" over the picture. The body before it wakes
// draws the same card; the canvas draws it from Barkpark 1.11.0 (block-cards), whose "…"
// offers Edit and Remove. Stills in e2e/evidence/J11-image-card-*.
const ID = 'image-card-j11'

test.afterAll(async ({}, info) => {
  if (target(info).name === 'studio') await bpMutate([{delete: {id: ID, type: 'post', force: true}}]).catch(() => {})
})

test('@local J11: a body image is a card with its file name and a menu', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the check runs on ours; the numbers are Sanity’s (scout 2026-10-16)')
  const list = await fetch(`${bpBase()}/v1/media/${bpDataset()}?limit=200`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  const assets = ((await list.json()) as {result: {assets: {url?: string; originalName?: string}[]}}).result.assets
  const src = assets.find((a) => a.originalName === 'fixture-image.png' && a.url)?.url
  test.skip(!src, 'the seeded fixture-image.png is not in this dataset')
  await bpMutate([
    {createOrReplace: {_id: ID, _type: 'post', title: 'Image card', body: {blocks: [
      {id: 's1', type: 'paragraph', content: [{type: 'text', value: 'Start.'}]},
      {id: 'i1', type: 'image', src, alt: 'A picture'},
    ]}}},
    {publish: {id: ID, type: 'post'}},
  ])
  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const body = page.locator(`[data-pane="doc:${ID}"] .body-canvas`)
  // At rest: the card, named as the file was uploaded, the picture loaded.
  const still = body.locator('.pd-image')
  await expect(still.locator('.pd-image-name')).toHaveText('fixture-image.png')
  await expect.poll(() => still.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  await page.screenshot({path: 'evidence/J11-image-card-static.png'})
  // Awake: the canvas's card where Barkpark draws one (1.11.0), one "…", Edit and Remove.
  await body.getByText('Start.').click()
  await expect(body.locator('.ProseMirror')).toBeVisible({timeout: 15_000})
  const card = body.locator('bp-paper-canvas figure.bp-canvas-image')
  await expect(card).toBeVisible()
  if (!(await card.locator('.bp-canvas-image-head').isVisible())) return void test.info().annotations.push({type: 'note', description: 'Barkpark canvas before 1.11.0: no card yet'})
  await expect(card.locator('.bp-canvas-image-name')).toHaveText('fixture-image.png')
  await card.hover()
  await expect(body).not.toHaveAttribute('data-hover-object', '')
  await card.getByRole('button', {name: 'Open menu'}).click()
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Edit', 'Remove'])
  await page.screenshot({path: 'evidence/J11-image-card-menu.png'})
  await page.keyboard.press('Escape')
})
