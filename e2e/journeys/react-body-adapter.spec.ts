import {expect, test} from '../rig/test'
import {bpMutate, target} from '../rig/targets'

const ID = 'react-body-adapter-rehearsal'

test.afterAll(async () => {
  await bpMutate([{delete: {id: ID, type: 'post', force: true}}]).catch(() => {})
})

test('@local: the React body adapter keeps hostile attributes inert through reload', async ({page}, info) => {
  const t = target(info)
  const badId = `p" $& $' data-evil="yes`
  const badDoc = 'doc" onmouseover="boom'
  const badSrc = 'https://example.invalid/pic.png" onerror="boom'
  const badAlt = 'alt" autofocus onfocus="boom'
  const safeSrc = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="2"%3E%3Crect width="2" height="2" fill="red"/%3E%3C/svg%3E'
  await bpMutate([
    {createOrReplace: {_id: ID, _type: 'post', title: 'React body adapter rehearsal', body: {blocks: [
      {id: badId, type: 'paragraph', content: [
        {type: 'text', value: 'Before '},
        {type: 'wikilink', docId: badDoc, children: [{type: 'text', value: 'Go'}]},
        {type: 'text', value: ' '},
        {type: 'constructor', text: 'Ctor'},
        {type: 'toString', text: 'String'},
        {type: '__proto__', text: 'Proto'},
      ]},
      {id: 'safe-image', type: 'image', src: safeSrc, alt: 'Safe image'},
      {id: 'bad-image', type: 'image', src: badSrc, alt: badAlt},
    ]}}},
    {publish: {id: ID, type: 'post'}},
  ])

  await page.goto(t.docPath('post', ID))
  await t.settle(page)
  const body = page.locator(`[data-pane="doc:${ID}"] .body-canvas`)
  await expect(body.locator('p').first()).toHaveAttribute('data-bp-id', badId)
  await expect(body.locator('[data-evil],[onmouseover],[onerror],[onfocus],[autofocus]')).toHaveCount(0)
  await expect(body.locator('.inline-object')).toHaveText(['Ctor', 'String', 'Proto'])
  expect(await body.locator('.inline-object').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-type')))).toEqual([
    'constructor', 'toString', '__proto__',
  ])
  await expect(body.locator('.wikilink')).toHaveAttribute('data-doc-id', badDoc)
  const images = body.locator('.pd-image img')
  await expect(images).toHaveCount(2)
  await expect(images.nth(1)).toHaveAttribute('src', badSrc)
  await expect(images.nth(1)).toHaveAttribute('alt', badAlt)
  await expect.poll(() => images.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 2)).toBe(true)

  await page.reload()
  await t.settle(page)
  await expect(body.locator('p').first()).toHaveAttribute('data-bp-id', badId)
  await expect(body.locator('.inline-object')).toHaveCount(3)
})
