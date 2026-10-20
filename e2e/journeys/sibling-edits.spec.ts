import {expect, test, type Page} from '@playwright/test'
import {bpMutate, signInIfAsked, target, type Target} from '../rig/targets'

// task-90f4187e4b90c2a8 (P1): a geopoint's lat, lng and alt, and an object's subfields, typed
// and then cleared one after another with no pause each keep exactly their own edit. The
// geopoint sent its whole object built on the value a render old: a typed lat was never
// stored and a cleared lng came back, on screen and in Barkpark. A scratch doc, deleted after.

/** Type into several inputs in one go, no render between them (what fast typing and tabbing can do). */
const typeAll = (page: Page, values: Record<string, string>) =>
  page.evaluate((v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    for (const [id, value] of Object.entries(v)) {
      const el = document.getElementById(id) as HTMLInputElement
      set.call(el, value)
      el.dispatchEvent(new Event('input', {bubbles: true}))
    }
  }, values)

async function open(page: Page, t: Target, id: string) {
  await bpMutate([{createOrReplace: {_id: id, _type: 'fieldTypes', title: 'Sibling edits'}}])
  await t.prepare(page.context())
  await page.goto(`${t.docPath('fieldTypes', id)},path=place`)
  await signInIfAsked(page)
  await t.settle(page) // typing before hydration is lost (a known limit, not this one)
}

async function round(page: Page, t: Target, id: string, n: number) {
  const stored = (field: string) => () => t.docValue(id, field, 'fieldTypes')
  await typeAll(page, {'place.lat': `60.${n}23456789`, 'place.lng': `8.${n}`, 'place.alt': `${n}20`, 'address.street': `Storgata ${n}`, 'address.city': 'Oslo'})
  await expect.poll(stored('place'), {timeout: 10_000}).toEqual({_type: 'geopoint', lat: Number(`60.${n}23456789`), lng: Number(`8.${n}`), alt: Number(`${n}20`)})
  await expect.poll(stored('address'), {timeout: 10_000}).toEqual({street: `Storgata ${n}`, city: 'Oslo'})
  await typeAll(page, {'place.lat': '', 'place.lng': '', 'place.alt': '', 'address.street': '', 'address.city': ''})
  // All cleared: the field goes, as Sanity's (task-dfb5fcd556879c59), not {} or {_type}.
  await expect.poll(stored('place'), {timeout: 10_000}).toBeUndefined()
  await expect.poll(stored('address'), {timeout: 10_000}).toBeUndefined()
  for (const p of ['place.lat', 'place.lng', 'place.alt']) await expect(page.locator(`[id="${p}"]`)).toHaveValue('')
}

test('sibling fields typed and cleared with no pause keep every edit', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's keeps every edit")
  const id = `ft-sib-${Date.now().toString(36)}`
  try {
    await open(page, t, id)
    await round(page, t, id, 1)
  } finally {
    await bpMutate([{delete: {id, type: 'fieldTypes', force: true}}]).catch(() => {})
  }
})

// The same by Playwright's fill, three rounds (a person's speed; the race took about one in two).
test('@local sibling fields filled and cleared in three rounds keep every edit', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's keeps every edit")
  test.setTimeout(60_000)
  const id = `ft-sib3-${Date.now().toString(36)}`
  try {
    await open(page, t, id)
    const f = (p: string) => page.locator(`[id="${p}"]`)
    const stored = (field: string) => () => t.docValue(id, field, 'fieldTypes')
    for (const n of [1, 2, 3]) {
      for (const [p, v] of [['place.lat', `60.${n}23456789`], ['place.lng', `8.${n}`], ['place.alt', `${n}20`]]) await f(p!).fill(v!)
      await expect.poll(stored('place'), {timeout: 10_000}).toEqual({_type: 'geopoint', lat: Number(`60.${n}23456789`), lng: Number(`8.${n}`), alt: Number(`${n}20`)})
      for (const p of ['place.lat', 'place.lng', 'place.alt']) await f(p).fill('')
      await expect.poll(stored('place'), {timeout: 10_000}).toBeUndefined()
      for (const p of ['place.lat', 'place.lng', 'place.alt']) await expect(f(p)).toHaveValue('')
    }
  } finally {
    await bpMutate([{delete: {id, type: 'fieldTypes', force: true}}]).catch(() => {})
  }
})
