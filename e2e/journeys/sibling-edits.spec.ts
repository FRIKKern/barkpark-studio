import {expect, test} from '@playwright/test'
import {bpMutate, signInIfAsked, target} from '../rig/targets'

// task-90f4187e4b90c2a8 (P1): a geopoint's lat, lng and alt, and an object's subfields, typed
// and then cleared one after another with no pause each keep exactly their own edit. The
// geopoint sent its whole object built on the value a render old: a typed lat was never
// stored and a cleared lng came back, on screen and in Barkpark. A scratch doc, deleted after.
test('sibling fields typed and cleared with no pause keep every edit', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's keeps every edit")
  const id = `ft-sib-${Date.now().toString(36)}`
  await bpMutate([{createOrReplace: {_id: id, _type: 'fieldTypes', title: 'Sibling edits'}}])
  try {
    await t.prepare(page.context())
    await page.goto(`${t.docPath('fieldTypes', id)},path=place`)
    await signInIfAsked(page)
    await t.settle(page) // typing before hydration is lost (a known limit, not this one)
    const f = (p: string) => page.locator(`[id="${p}"]`)
    const stored = (field: string) => () => t.docValue(id, field, 'fieldTypes')
    // Three rounds: the race lost an edit about one round in two.
    for (const round of [1, 2, 3]) {
      await f('place.lat').fill(`60.${round}23456789`)
      await f('place.lng').fill(`8.${round}`)
      await f('place.alt').fill(`${round}20`)
      await f('address.street').fill(`Storgata ${round}`)
      await f('address.city').fill('Oslo')
      await expect.poll(stored('place'), {timeout: 10_000}).toEqual({_type: 'geopoint', lat: Number(`60.${round}23456789`), lng: Number(`8.${round}`), alt: Number(`${round}20`)})
      await expect.poll(stored('address'), {timeout: 10_000}).toEqual({street: `Storgata ${round}`, city: 'Oslo'})
      for (const p of ['place.lat', 'place.lng', 'place.alt', 'address.street', 'address.city']) await f(p).fill('')
      await expect.poll(async () => Object.keys(((await stored('place')()) ?? {}) as object).filter((k) => k !== '_type'), {timeout: 10_000}).toEqual([])
      await expect.poll(async () => Object.keys(((await stored('address')()) ?? {}) as object), {timeout: 10_000}).toEqual([])
      for (const p of ['place.lat', 'place.lng', 'place.alt']) await expect(f(p)).toHaveValue('')
    }
  } finally {
    await bpMutate([{delete: {id, type: 'fieldTypes', force: true}}]).catch(() => {})
  }
})
