import {expect, test, type Page} from '../rig/test'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {seedAssets} from '../../scripts/lib/seed-assets.mjs'
import {bpBase, bpDataset, bpMutate, signInIfAsked, target, bpRemove, closeAndSettle} from '../rig/targets'

// An image's stored shape (task-fd8c8097867ebe9f): a new pick stores Sanity's canonical
// {_type: 'image', asset: {_type: 'reference', _ref}}; the bare {asset: {_ref}} older content
// holds reads the same, and is never rewritten by an edit elsewhere in the doc. Two scratch
// posts on this run's dataset, deleted after; the image is the fixture's (one asset per file).
test('image shape: the old and the canonical read the same; an untouched old one is not rewritten; a new pick is canonical', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's only stores the canonical shape")
  const ref = (await seedAssets([{img: {_sanityAsset: 'image@file://./assets/fixture-image.png'}}], {base: bpBase(), dataset: bpDataset(), token: process.env.BARKPARK_TOKEN!}))({_sanityAsset: 'image@file://./assets/fixture-image.png'})
  const stamp = Date.now().toString(36)
  const OLD = `post-shape-old-${stamp}`
  const NEW = `post-shape-new-${stamp}`
  const old = {asset: {_ref: ref}, alt: 'Same picture'}
  await bpMutate([
    {createOrReplace: {_id: OLD, _type: 'post', title: `Shape old ${stamp}`, mainImage: old}},
    {createOrReplace: {_id: NEW, _type: 'post', title: `Shape new ${stamp}`, mainImage: {_type: 'image', asset: {_type: 'reference', _ref: ref}, alt: 'Same picture'}}},
  ])
  try {
    await t.prepare(page.context())
    const drawn = async (id: string) => {
      await page.goto(`${t.docPath('post', id)},path=mainImage`)
      await signInIfAsked(page)
      const field = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
      const img = field.getByRole('img', {name: 'Preview of uploaded image'})
      await expect(img).toBeVisible()
      return {src: await img.getAttribute('src'), alt: await field.getByRole('textbox', {name: 'Alternative text'}).inputValue()}
    }
    expect(await drawn(OLD)).toEqual(await drawn(NEW))
    // An edit elsewhere saves the doc; its image keeps the shape it had.
    await page.goto(t.docPath('post', OLD))
    await t.settle(page)
    await editTitle(page, t.field(page, 'title'))
    await expect.poll(() => t.docValue(OLD, 'title'), {timeout: 10_000}).toMatch(/ edited$/)
    expect(await t.docValue(OLD, 'mainImage')).toEqual(old)
    // A new pick (Upload, the same file: the library has it) stores the canonical shape.
    const field = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
    await field.locator('input[type=file]').first().setInputFiles('../fixtures/assets/fixture-image.png')
    await expect.poll(() => t.docValue(OLD, 'mainImage'), {timeout: 15_000}).toEqual({_type: 'image', asset: {_type: 'reference', _ref: ref}, alt: 'Same picture'})
  } finally {
    await closeAndSettle(page)
    await Promise.all([bpRemove(OLD, 'post'), bpRemove(NEW, 'post')])
  }
})

// task-894b06f33c89ed1e: a value moved over from Sanity holds a Sanity image id,
// image-<sha1>-<w>x<h>-<ext>. Barkpark serves it from its Sanity image route (by the sha1 of
// the bytes), so the field draws the image with its alt, offers no Reset card, and a new
// pick replaces it. The fixture image's own id, on a scratch post deleted after.
test('a Sanity image id: drawn with its alt, no warning card; a new pick replaces it', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: Sanity shows its own assets')
  const ref = (await seedAssets([{img: {_sanityAsset: 'image@file://./assets/fixture-image.png'}}], {base: bpBase(), dataset: bpDataset(), token: process.env.BARKPARK_TOKEN!}))({_sanityAsset: 'image@file://./assets/fixture-image.png'})
  const png = readFileSync(new URL('../../fixtures/assets/fixture-image.png', import.meta.url))
  const sanityRef = `image-${createHash('sha1').update(png).digest('hex')}-${png.readUInt32BE(16)}x${png.readUInt32BE(20)}-png`
  const ID = `post-sanity-image-${Date.now().toString(36)}`
  await bpMutate([{createOrReplace: {_id: ID, _type: 'post', title: 'Sanity image id', mainImage: {_type: 'image', asset: {_type: 'reference', _ref: sanityRef}, alt: 'Synthetic alt'}}}])
  try {
    await t.prepare(page.context())
    const known = page.waitForResponse((r) => r.url().includes(`/api/media/${sanityRef}/info`))
    await page.goto(`${t.docPath('post', ID)},path=mainImage`)
    await signInIfAsked(page)
    expect((await known).status()).toBe(200)
    const field = page.locator('fieldset.field').filter({has: page.locator('[id="mainImage"]')})
    const img = field.getByRole('img', {name: 'Preview of uploaded image'})
    await expect(img).toBeVisible()
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0)
    await expect(field.getByRole('textbox', {name: 'Alternative text'})).toHaveValue('Synthetic alt')
    await expect(page.getByText('Unsupported asset value')).toHaveCount(0)
    // A new pick (Upload; the library has the file) replaces the Sanity id, keeping the alt.
    await field.locator('input[type=file]').first().setInputFiles('../fixtures/assets/fixture-image.png')
    await expect.poll(() => t.docValue(ID, 'mainImage'), {timeout: 15_000}).toEqual({_type: 'image', asset: {_type: 'reference', _ref: ref}, alt: 'Synthetic alt'})
  } finally {
    await closeAndSettle(page)
    await bpRemove(ID, 'post')
  }
})

async function editTitle(page: Page, title: ReturnType<Page['locator']>) {
  await expect(title).toBeEditable()
  await title.click()
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await page.keyboard.type(' edited')
}

// task-8a7b8265fc3b5fc3: with a crop set, the image input shows the crop only, as Sanity's
// (its rect=320,0,320,280 for this crop of the 640 x 400 fixture): a 320:280 box, the image
// inside at twice the box's width and moved a box's width left.
test('@local image preview: a set crop shows only the crop, at its own ratio', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: Sanity crops in its image URL')
  const ref = (await seedAssets([{img: {_sanityAsset: 'image@file://./assets/fixture-image.png'}}], {base: bpBase(), dataset: bpDataset(), token: process.env.BARKPARK_TOKEN!}))({_sanityAsset: 'image@file://./assets/fixture-image.png'})
  const ID = `post-crop-${Date.now().toString(36)}`
  const crop = {_type: 'sanity.imageCrop', top: 0, bottom: 0.3, left: 0.5, right: 0}
  await bpMutate([{createOrReplace: {_id: ID, _type: 'post', title: 'Crop preview', mainImage: {_type: 'image', asset: {_type: 'reference', _ref: ref}, crop}}}])
  try {
    await t.prepare(page.context())
    await page.goto(`${t.docPath('post', ID)},path=mainImage`)
    await signInIfAsked(page)
    const box = page.locator('[id="mainImage"] .image-crop')
    await expect(box).toBeVisible()
    const b = (await box.boundingBox())!
    expect(Math.abs(b.width / b.height - 320 / 280)).toBeLessThan(0.01)
    expect(b.height).toBeLessThanOrEqual(270.5)
    const img = (await box.getByRole('img', {name: 'Preview of uploaded image'}).boundingBox())!
    expect(Math.round(img.width / b.width)).toBe(2)
    expect(Math.round(img.x - b.x)).toBe(-Math.round(b.width))
  } finally {
    await closeAndSettle(page)
    await bpRemove(ID, 'post')
  }
})
