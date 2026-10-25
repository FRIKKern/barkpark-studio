import {expect, test} from '../rig/test'
import {bpMutate, signInIfAsked, target, bpRemove, closeAndSettle} from '../rig/targets'

// J28 guard (a CI gate), as Sanity's slug rule: a duplicate's copied slug is "already in
// use": the field is marked, publishing waits, and a new slug clears it. The copy is
// deleted whatever happens.
test('J28: a duplicated document flags its copied slug as already in use', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: the reference shows the same mark in the J28 evidence clip')
  await t.prepare(page.context())
  await page.goto(t.docPath('post', 'post-27'))
  await signInIfAsked(page)
  await t.settle(page)
  const taken = page.locator('.field:has([id="slug"])').getByRole('img', {name: /Slug is already in use/})
  await expect(taken).toHaveCount(0)
  await page.getByRole('button', {name: 'Document actions'}).last().click()
  await page.getByRole('menuitem', {name: 'Duplicate'}).click()
  await page.waitForURL(/\/structure\/post;[0-9a-f-]{36}$/)
  const copy = decodeURIComponent(page.url()).match(/;([0-9a-f-]{36})$/)![1]!
  try {
    await expect(taken).toHaveCount(1)
    await expect(page.getByRole('button', {name: 'Publish'}).last()).toBeDisabled()
    await page.locator('[id="slug"]').fill(`fixture-post-27-${copy.slice(0, 8)}`)
    await expect(taken).toHaveCount(0)
  } finally {
    await t.deleteDoc(copy, 'post')
  }
})

// A slug in Sanity's shape ({_type: 'slug', current}, as imported content holds it) is the
// same slug as Barkpark's plain string: each post sees the other's as taken, either way round
// (the string-only check missed the object one, and a copy published with it). Scratch posts.
test("a slug is in use whether it is stored as a string or as Sanity's {current}", async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's slugs have one shape")
  const stamp = Date.now().toString(36)
  const [obj, str] = [`post-slugobj-${stamp}`, `post-slugstr-${stamp}`]
  const slug = `shared-slug-${stamp}`
  await bpMutate([
    {createOrReplace: {_id: obj, _type: 'post', title: 'Slug object', slug: {_type: 'slug', current: slug}}},
    {createOrReplace: {_id: str, _type: 'post', title: 'Slug string', slug}},
  ])
  try {
    await t.prepare(page.context())
    const taken = page.locator('.field:has([id="slug"])').getByRole('img', {name: /Slug is already in use/})
    for (const id of [str, obj]) {
      await page.goto(t.docPath('post', id))
      await signInIfAsked(page)
      await expect(taken, id).toHaveCount(1)
    }
  } finally {
    await closeAndSettle(page)
    await Promise.all([bpRemove(obj, 'post'), bpRemove(str, 'post')])
  }
})

// The form's "not in use" answer is kept 10 s; a slug someone else takes inside that window
// was published as a duplicate. Publish asks again first, as Sanity's does, and refuses.
test('publish asks again whether the slug is in use, and refuses one taken meanwhile', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's publish validates afresh")
  const stamp = Date.now().toString(36)
  const [mine, theirs] = [`post-slugpub-${stamp}`, `post-slugtook-${stamp}`]
  const slug = `taken-meanwhile-${stamp}`
  await bpMutate([{createOrReplace: {_id: mine, _type: 'post', title: 'Slug publish', slug}}])
  try {
    await t.prepare(page.context())
    const asked = page.waitForResponse((r) => r.url().includes('/_serverFn/') && r.url().includes(slug))
    await page.goto(t.docPath('post', mine))
    await signInIfAsked(page)
    const publish = page.getByRole('button', {name: 'Publish'}).last()
    await expect(publish).toBeEnabled()
    await asked // the form's check: not in use
    await bpMutate([{createOrReplace: {_id: theirs, _type: 'post', title: 'Took it', slug}}])
    await publish.click()
    await expect(page.locator('.field:has([id="slug"])').getByRole('img', {name: /Slug is already in use/})).toHaveCount(1)
    await expect(publish).toBeDisabled()
    expect((await t.versions(mine)).published, 'not published').toBeUndefined()
  } finally {
    await closeAndSettle(page)
    await Promise.all([bpRemove(mine, 'post'), bpRemove(theirs, 'post')])
  }
})
