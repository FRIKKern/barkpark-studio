import {expect, test, type Page} from '@playwright/test'
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

async function editTitle(page: Page, title: ReturnType<Page['locator']>) {
  await expect(title).toBeEditable()
  await title.click()
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await page.keyboard.type(' edited')
}
