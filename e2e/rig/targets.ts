import {readFileSync} from 'node:fs'
import type {BrowserContext, Locator, Page, TestInfo} from '@playwright/test'
import {sendBatches} from '../../scripts/lib/batches.mjs'
import {idempotent, isTransient} from '../../scripts/lib/retry.mjs'
import {sanityAsset, seedAssets} from '../../scripts/lib/seed-assets.mjs'
import {toBarkpark} from '../../scripts/lib/seed-map.mjs'

// The rig's own Barkpark and Sanity calls (setup, teardown, reads) go over Node's fetch, which
// keeps sockets alive between calls: one the far end dropped meanwhile (a Barkpark deploy flip)
// fails the next call before any answer, "fetch failed / other side closed" or ECONNRESET (three
// CI runs on 2026-10-16, task-4033f12dd0007724). Asked again once when sending twice is harmless:
// a read, or a mutate batch scripts/lib/retry.mjs calls idempotent. Every spec loads this file.
const sameTwice = (init?: RequestInit) => {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return true
  try {
    const {mutations} = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {mutations?: unknown}
    return Array.isArray(mutations) && idempotent(mutations)
  } catch {
    return false
  }
}
const nativeFetch = globalThis.fetch as typeof fetch & {rigRetry?: true}
if (!nativeFetch.rigRetry)
  globalThis.fetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      nativeFetch(input, init).catch((error: unknown) => (isTransient({error}) && sameTwice(init) ? nativeFetch(input, init) : Promise.reject(error))),
    {rigRetry: true as const},
  )

// One adapter per backend. Specs talk to the adapter, never to a backend directly,
// so every spec runs against the reference (the bar) and against ours unchanged.
// Ours mirrors Sanity's DOM hooks on purpose: field inputs carry id=<field path>,
// list rows are links whose href ends in the doc id.
export type Target = {
  name: 'sanity' | 'studio'
  /** Make a fresh context able to edit (auth, dismiss onboarding). */
  prepare(ctx: BrowserContext): Promise<void>
  /** Close one-off popups the target shows on load. */
  settle(page: Page): Promise<void>
  listPath(type: string): string
  docPath(type: string, id: string): string
  listItem(page: Page, id: string): Locator
  field(page: Page, path: string): Locator
  /** The pane at `index` (both studios mark panes with data-pane-index, strips with data-pane-collapsed). */
  pane(page: Page, index: number): Locator
  /** The reference preview link for `field` inside a pane. */
  refLink(pane: Locator, field: string): Locator
  closeButton(pane: Locator): Locator
  /** The close of one side of a split (Sanity: "Close split pane"). */
  closeSplit(pane: Locator): Locator
  /** The "…" options menu of a type list pane (sort, layout). */
  listMenu(listPane: Locator): Locator
  /** The "+" that creates a new document from a type list pane. */
  newDocButton(listPane: Locator): Locator
  /** The document actions "…" menu in a doc pane's footer. */
  docMenu(page: Page): Locator
  /** The "…" actions button of a reference field showing a value. */
  refMenu(pane: Locator, field: string): Locator
  /** The "…" of a reference whose doc does not exist ("Document unavailable"). */
  unavailableRefMenu(pane: Locator): Locator
  /** Write straight to the backend over HTTP, as another client would. */
  patch(id: string, set: Record<string, unknown>, type?: string): Promise<void>
  /** A reference value in this backend's shape. */
  ref(id: string): unknown
  /** A reference to a missing doc, or (with `type`) to an unpublished one: Sanity needs these weak. */
  weakRef(id: string, type?: string): unknown
  /** Create a doc that exists only as a draft (never published). */
  draftOnly(id: string, type: string, set: Record<string, unknown>): Promise<void>
  /** Titles of both versions, straight from the backend (undefined = no such version). */
  versions(id: string): Promise<{draft?: string; published?: string}>
  /** A field as editors now see it (draft if there is one, else published). */
  docValue(id: string, field: string, type?: string): Promise<unknown>
  /** Put a seed document back exactly as fixtures/seed.ndjson has it, no draft. */
  resetDoc(id: string, type: string): Promise<void>
  /** The title of the published version, straight from the backend. */
  publishedTitle(id: string): Promise<string | undefined>
  /** Delete a document (draft and published) a test created. */
  deleteDoc(id: string, type: string): Promise<void>
  /** Drop drafts a test left behind and restore published values. */
  restore(id: string, set: Record<string, unknown>, type?: string, unset?: string[]): Promise<void>
  /** Drop a doc's draft only: the published version and its history stay as they are. */
  discardDraft(id: string, type: string): Promise<void>
  /** The backend's history has the doc's latest writes (published and draft): poll before reading history in the UI. */
  historyReady(id: string): Promise<boolean>
}

/**
 * Before an afterEach puts fixture docs back: let the page's saves land, then close it,
 * or a save (or a write the reset itself sets off) lands after the reset and leaves a
 * draft behind. Ours says when no save is on its way (lib/edits.ts); Sanity, which
 * batches its saves, gets 3 s.
 */
export async function closeAndSettle(page: Page) {
  if (page.isClosed()) return
  if (page.url() === 'about:blank') return void (await page.close())
  const ours = await page.evaluate(() => typeof (window as {__savesPending?: unknown}).__savesPending === 'function').catch(() => false)
  if (ours) await page.waitForFunction(() => !(window as unknown as {__savesPending: () => boolean}).__savesPending(), null, {timeout: 5_000}).catch(() => {})
  await page.close()
  if (!ours) await new Promise((r) => setTimeout(r, 3000))
}

/**
 * Ours: until no save of this page is on its way (lib/edits.ts), checked every 50 ms, so
 * the Barkpark read that follows finds the value at its first try instead of waiting out
 * expect.poll's backoff (up to 1 s past the moment it landed; Barkpark reads stay slow, the
 * rig's read bucket is 300/min). It asserts nothing: the read after it does. No wait on
 * Sanity's page, or if the page never settles (the read's own timeout says so).
 */
export async function savesLanded(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => !(window as unknown as {__savesPending?: () => boolean}).__savesPending?.(), null, {timeout, polling: 50}).catch(() => {})
}

/**
 * Before keys that move the selection in a canvas that just took focus. ProseMirror's
 * focus handler puts its own selection back on the page 20 ms after focus when the page's
 * differs from the one it last read (prosemirror-view, `handlers.focus`). An End or
 * Shift+Arrow sent inside that window is read after it, so it is undone (J10 on a cold CI
 * shard: '.' bolded, not '1.'). Waits until that timer has run; no wait on Sanity's page.
 */
export async function canvasFocusSettled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const view = (document.activeElement?.closest('bp-paper-canvas') as unknown as {_editor?: {view?: {input?: {lastFocus?: number}}}} | null)?._editor?.view
        // A timer due after ProseMirror's runs after it: timers fire in due order.
        setTimeout(done, Math.max(0, (view?.input?.lastFocus ?? 0) + 21 - Date.now()))
      }),
  )
}

/**
 * A list row, rendered. Sanity's list is virtual (about 25 rows drawn) and sorted by
 * last edit, so after a few runs a fixture post can sit below the drawn rows: scroll
 * the list until the row exists. Ours renders every row, so this returns at once.
 */
export async function reveal(item: Locator) {
  const page = item.page()
  // Step its virtual list's scroller down (what a wheel does) until the row is drawn.
  for (let i = 0; i < 30 && !(await item.count()); i++) {
    // From the top first (an earlier reveal may have left it scrolled past the row).
    await page.evaluate((step) => {
      // The last list row on the page: a link one pane deep (`/structure/post;post-02`),
      // not a document pane's own links further down the chain.
      let box = [...document.querySelectorAll<HTMLElement>('a[href^="/structure/"]')].filter((a) => a.getAttribute('href')!.split(';').length === 2).at(-1)?.parentElement ?? null
      while (box && !(box.scrollHeight > box.clientHeight + 5 && getComputedStyle(box).overflowY !== 'visible')) box = box.parentElement
      if (box) box.scrollTop = step ? box.scrollTop + box.clientHeight * 0.8 : 0
    }, i)
    await page.waitForTimeout(250)
  }
  await item.scrollIntoViewIfNeeded()
  return item
}

/** One document of fixtures/seed.ndjson, as Sanity holds it. */
function seedDoc(id: string) {
  const doc = readFileSync(new URL('../../fixtures/seed.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((d) => d._id === id)
  return doc ?? fail(`${id} is not in fixtures/seed.ndjson`)
}

/**
 * How many documents of `type` a seeded list shows: the fixture's, plus post-history
 * when it exists (scripts/reference-history.mjs makes it after every local reset;
 * CI skips it). Counted, not hard-coded, so both studios compare on the same data.
 */
export async function seededCount(t: Target, type: string) {
  const ids = new Set(
    readFileSync(new URL('../../fixtures/seed.ndjson', import.meta.url), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as {_id: string; _type: string})
      .filter((d) => d._type === type)
      .map((d) => d._id.replace(/^drafts\./, '')),
  )
  const history = type === 'post' && (await t.versions('post-history')).published !== undefined
  return ids.size + (history ? 1 : 0)
}

const need = (k: string) => process.env[k] ?? fail(`missing ${k} in ../.env`)
function fail(msg: string): never {
  throw new Error(msg)
}

async function ok(res: Response) {
  if (!res.ok) throw new Error(`${res.url} → ${res.status} ${await res.text()}`)
  return res
}

const SANITY_DATASET = process.env.SANITY_STUDIO_DATASET || 'production'
const SANITY_API = `https://ecu57yeh.api.sanity.io/v2025-02-19/data/mutate/${SANITY_DATASET}`
/** A write to the reference's dataset (never its production one). */
export const sanityMutate = (mutations: unknown[]) => {
  if (SANITY_DATASET === 'production') throw new Error('Reference test writes require SANITY_STUDIO_DATASET=e2e-local; start the reference with the same dataset.')
  return fetch(SANITY_API, {
    method: 'POST',
    headers: {authorization: `Bearer ${need('SANITY_TOKEN')}`, 'content-type': 'application/json'},
    body: JSON.stringify({mutations}),
  }).then(ok)
}

/** Sanity's document actions (edit a draft, publish it), same guard as sanityMutate. */
const sanityActions = (actions: unknown[]) => {
  if (SANITY_DATASET === 'production') throw new Error('Reference test writes require SANITY_STUDIO_DATASET=e2e-local; start the reference with the same dataset.')
  return fetch(SANITY_API.replace('/data/mutate/', '/data/actions/'), {
    method: 'POST',
    headers: {authorization: `Bearer ${need('SANITY_TOKEN')}`, 'content-type': 'application/json'},
    body: JSON.stringify({actions}),
  }).then(ok)
}

const sanity: Target = {
  name: 'sanity',
  async prepare(ctx) {
    // Cover UI writes too, including Sanity's newer actions API. A reference
    // accidentally built for production must never mutate it during a test.
    await ctx.route(/\/data\/(?:mutate|actions)\//, (route) => {
      const allowed = SANITY_DATASET !== 'production' && new URL(route.request().url()).pathname.endsWith(`/${SANITY_DATASET}`)
      return allowed ? route.continue() : route.abort('blockedbyclient')
    })
    await ctx.addInitScript((token) => {
      localStorage.setItem('__studio_auth_token_ecu57yeh', JSON.stringify({token, time: new Date().toISOString()}))
    }, need('SANITY_TOKEN'))
  },
  async settle(page) {
    // Its onboarding popups arrive a moment after the panes and take the keyboard.
    await page.locator('[data-testid="structure-tool-list-pane"]').first().waitFor()
    await page.waitForTimeout(1500)
    for (const name of ['Got it', 'Dismiss announcements']) {
      const b = page.getByRole('button', {name})
      if (await b.isVisible().catch(() => false)) await b.click()
    }
  },
  listPath: (type) => `/structure/${type}`,
  docPath: (type, id) => `/structure/${type};${id}`,
  listItem: (page, id) => page.locator(`a[href$=";${id}"]`),
  field: (page, path) => page.locator(`[id="${path}"]`),
  pane: (page, index) => page.locator(`[data-pane-index="${index}"]`),
  refLink: (pane, field) => {
    // Sanity puts parentRefPath last, except on a just-created doc (…,parentRefPath=x,type=y).
    const f = encodeURIComponent(field)
    return pane.locator(`a[href$="parentRefPath%3D${f}"], a[href*="parentRefPath%3D${f}%2C"]`).first()
  },
  closeButton: (pane) => pane.locator('a:has([data-sanity-icon="close"])').first(),
  closeSplit: (pane) => pane.locator('button:has([data-sanity-icon="close"])').first(),
  docMenu: (page) => page.locator('[data-testid="action-menu-button"]').last(),
  newDocButton: (listPane) => listPane.locator('a:has([data-sanity-icon="add"]), button:has([data-sanity-icon="add"])').first(),
  listMenu: (listPane) => listPane.getByTestId('pane-context-menu-button').first(),
  refMenu: (pane, field) =>
    pane
      .locator(`a[href$="parentRefPath%3D${encodeURIComponent(field)}"]`)
      .first()
      .locator('xpath=ancestor::*[.//button[.//*[@data-sanity-icon="ellipsis-horizontal"]]][1]')
      .locator('button:has([data-sanity-icon="ellipsis-horizontal"])')
      .first(),
  unavailableRefMenu: (pane) =>
    pane
      .getByText('Document unavailable')
      .locator('xpath=ancestor::*[.//button[.//*[@data-sanity-icon="ellipsis-horizontal"]]][1]')
      .locator('button:has([data-sanity-icon="ellipsis-horizontal"])')
      .first(),
  ref: (id) => ({_type: 'reference', _ref: id}),
  weakRef: (id, type) => ({_type: 'reference', _ref: id, _weak: true, ...(type && {_strengthenOnPublish: {type}})}),
  draftOnly: (id, type, set) => sanityMutate([{delete: {id}}, {createOrReplace: {_id: `drafts.${id}`, _type: type, ...set}}]).then(() => {}),
  versions: async (id) => {
    const q = encodeURIComponent(`*[_id in ["${id}", "drafts.${id}"]]{_id, title}`)
    const r = await fetch(`https://ecu57yeh.api.sanity.io/v2025-02-19/data/query/${SANITY_DATASET}?query=${q}&perspective=raw`, {
      headers: {authorization: `Bearer ${need('SANITY_TOKEN')}`},
    }).then(ok)
    const rows = ((await r.json()) as {result: {_id: string; title: string}[]}).result
    return {draft: rows.find((x) => x._id.startsWith('drafts.'))?.title, published: rows.find((x) => x._id === id)?.title}
  },
  docValue: async (id, field) => {
    const q = encodeURIComponent(`coalesce(*[_id == "drafts.${id}"][0], *[_id == "${id}"][0]).${field}`)
    const r = await fetch(`https://ecu57yeh.api.sanity.io/v2025-02-19/data/query/${SANITY_DATASET}?query=${q}&perspective=raw`, {
      headers: {authorization: `Bearer ${need('SANITY_TOKEN')}`},
    }).then(ok)
    return ((await r.json()) as {result: unknown}).result
  },
  resetDoc: async (id) => {
    // A file the seed carries (`_sanityAsset`) is only resolved by an import: point at the imported asset.
    const seed = Object.fromEntries(Object.entries(seedDoc(id)).map(([k, v]) => [k, v?._sanityAsset ? sanityAsset(v) : v]))
    await sanityMutate([{delete: {id: `drafts.${id}`}}, {createOrReplace: seed}])
    // Then a real publish, so Sanity's history knows this version (see restore).
    const draftId = `drafts.${id}`
    await sanityActions([{actionType: 'sanity.action.document.edit', draftId, publishedId: id, patch: {set: {title: seed.title}}}])
    await sanityActions([{actionType: 'sanity.action.document.publish', draftId, publishedId: id}])
  },
  publishedTitle: async (id) => {
    const q = encodeURIComponent(`*[_id == "${id}"][0].title`)
    const r = await fetch(`https://ecu57yeh.api.sanity.io/v2025-02-19/data/query/${SANITY_DATASET}?query=${q}&perspective=published`, {
      headers: {authorization: `Bearer ${need('SANITY_TOKEN')}`},
    }).then(ok)
    return ((await r.json()) as {result?: string}).result
  },
  deleteDoc: (id) => sanityMutate([{delete: {id: `drafts.${id}`}}, {delete: {id}}]).then(() => {}),
  patch: (id, set) => sanityMutate([{patch: {id, set}}]).then(() => {}),
  // Restored through a draft and a real publish: a patch straight onto the published
  // doc leaves Sanity's history without a publish event, and its Review changes then
  // reads "Since: unknown version" with no changes listed (J15).
  restore: async (id, set, _type, unset = []) => {
    await sanityMutate([{delete: {id: `drafts.${id}`}}])
    const draftId = `drafts.${id}`
    await sanityActions([{actionType: 'sanity.action.document.edit', draftId, publishedId: id, patch: {set, unset}}])
    await sanityActions([{actionType: 'sanity.action.document.publish', draftId, publishedId: id}])
  },
  discardDraft: (id) => sanityMutate([{delete: {id: `drafts.${id}`}}]).then(() => {}),
  // A Sanity doc's _rev is the id of the transaction that last wrote it; the transaction log
  // lags the document store, and a Review changes opened before it catches up reads
  // "Since: unknown version / There are no changes". Ready once the log lists both _revs.
  historyReady: async (id) => {
    const headers = {authorization: `Bearer ${need('SANITY_TOKEN')}`}
    const q = encodeURIComponent(`*[_id in ["${id}", "drafts.${id}"]]._rev`)
    const revs = ((await (await fetch(`https://ecu57yeh.api.sanity.io/v2025-02-19/data/query/${SANITY_DATASET}?query=${q}&perspective=raw`, {headers})).json()) as {result: string[]}).result
    const log = await (await fetch(`https://ecu57yeh.api.sanity.io/v2025-02-19/data/history/${SANITY_DATASET}/transactions/${id},drafts.${id}?excludeContent=true&reverse=true&limit=20`, {headers})).text()
    const ids = new Set(log.split('\n').filter(Boolean).map((l) => (JSON.parse(l) as {id: string}).id))
    return revs.length > 0 && revs.every((r) => ids.has(r))
  },
}

export const bpBase = () => `${need('BARKPARK_URL')}/w/${need('BARKPARK_WORKSPACE')}/p/${process.env.BARKPARK_PROJECT || 'default'}`
export const bpDataset = () => process.env.BARKPARK_DATASET || 'production'
// A 429 waits out Retry-After, as the studio's own server does: here one token is
// shared by both browsers, the rig and presence (task-2c31de0cf6597d32).
// Deletes go in batches under Barkpark's cap (scripts/lib/batches.mjs).
export const bpMutate = async (mutations: unknown[]): Promise<Response> => ok((await sendBatches(mutations, (part) => bpSend(part)))!)
const bpSend = async (mutations: unknown[], waits = 3): Promise<Response> => {
  const res = await fetch(`${bpBase()}/v1/data/mutate/${bpDataset()}`, {
    method: 'POST',
    headers: {authorization: `Bearer ${need('BARKPARK_TOKEN')}`, 'content-type': 'application/json'},
    body: JSON.stringify({mutations}),
  })
  if (res.status === 429 && waits > 0) {
    const s = Math.min(Number(res.headers.get('retry-after')) || 1, 5)
    return new Promise((r) => setTimeout(() => r(bpSend(mutations, waits - 1)), s * 1000 + 100))
  }
  return res
}

/**
 * A scratch doc gone for good, draft and published, and checked after: a failure throws.
 * A swallowed one left drafts that other journeys' lists then counted (J01, J47).
 */
export async function bpRemove(id: string, type: string) {
  await bpMutate([{delete: {id, type, force: true}}])
  for (const p of ['drafts', 'published']) {
    const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/${type}/${encodeURIComponent(id)}?perspective=${p}`, {headers: {authorization: `Bearer ${need('BARKPARK_TOKEN')}`}})
    if (r.status !== 404) throw new Error(`${id} is still there after its delete (${p}: ${r.status})`)
  }
}

const studio: Target = {
  name: 'studio',
  async prepare() {},
  // SSR paints before hydration; a click before then is a full page load, not a pane open.
  settle: (page) => page.locator('html[data-hydrated]').waitFor({state: 'attached'}),
  listPath: (type) => `/structure/${type}`,
  docPath: (type, id) => `/structure/${type};${id}`,
  listItem: (page, id) => page.locator(`a[href$=";${id}"]`),
  field: (page, path) => page.locator(`[id="${path}"]`),
  pane: (page, index) => page.locator(`[data-pane-index="${index}"]`),
  refLink: (pane, field) => pane.locator(`a[href$="parentRefPath=${encodeURIComponent(field)}"]:not([data-testid="pane-close"])`).first(),
  closeButton: (pane) => pane.getByTestId('pane-close'),
  closeSplit: (pane) => pane.getByRole('button', {name: 'Close split pane'}),
  docMenu: (page) => page.getByRole('button', {name: 'Document actions'}).last(),
  newDocButton: (listPane) => listPane.getByRole('button', {name: /^Create new/}),
  listMenu: (listPane) => listPane.getByRole('button', {name: 'List options'}),
  refMenu: (pane, field) =>
    pane
      .locator('.ref-row')
      .filter({has: pane.page().locator(`a[href$="parentRefPath=${encodeURIComponent(field)}"]`)})
      .getByRole('button', {name: 'Reference actions'}),
  unavailableRefMenu: (pane) => pane.locator('.ref-row:has(.unavailable)').getByRole('button', {name: 'Reference actions'}),
  ref: (id) => id,
  weakRef: (id) => id,
  draftOnly: async (id, type, set) => {
    await bpMutate([{delete: {id, type}}]).catch(() => {}) // a leftover from an earlier run
    await bpMutate([{create: {_id: id, _type: type, ...set}}])
  },
  versions: async (id) => {
    const get = async (p: string) => {
      const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/post/${id}?perspective=${p}`, {headers: {authorization: `Bearer ${need('BARKPARK_TOKEN')}`}})
      return r.ok ? ((await r.json()) as {result: {_draft: boolean; title: string}}).result : undefined
    }
    const [d, p] = await Promise.all([get('drafts'), get('published')])
    return {draft: d?._draft ? d.title : undefined, published: p?.title}
  },
  docValue: async (id, field, type = 'post') => {
    const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/${type}/${encodeURIComponent(id)}?perspective=drafts`, {headers: {authorization: `Bearer ${need('BARKPARK_TOKEN')}`}})
    return r.ok ? ((await r.json()) as {result: Record<string, unknown>}).result[field] : undefined
  },
  // The whole seed document, as scripts/seed-barkpark.mjs writes it, replaces the draft
  // and is published: whatever a journey changed (a pasted document, J29) is gone.
  resetDoc: async (id, type) => {
    // A draft the run left would otherwise survive the replace and be what gets published.
    await bpMutate([{discardDraft: {id, type}}]).catch(() => {}) // none: nothing to discard
    const doc = seedDoc(id)
    const asset = await seedAssets([doc], {base: bpBase(), dataset: bpDataset(), token: need('BARKPARK_TOKEN')})
    await bpMutate([{createOrReplace: {_id: id, _type: type, ...toBarkpark(doc, asset)}}, {publish: {id, type}}])
  },
  publishedTitle: async (id) => {
    const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/post/${id}?perspective=published`, {
      headers: {authorization: `Bearer ${need('BARKPARK_TOKEN')}`},
    }).then(ok)
    return ((await r.json()) as {result?: {title?: string}}).result?.title
  },
  // force: a never-published draft goes too (a plain delete leaves it). Gone already is fine.
  deleteDoc: (id, type) => bpMutate([{delete: {id, type, force: true}}]).then(() => {}, () => {}),
  // Barkpark: a patch on a published doc writes its draft; publish lands it like an HTTP client would.
  patch: (id, set, type = 'post') => bpMutate([{patch: {id, type, set}}, {publish: {id, type}}]).then(() => {}),
  restore: (id, set, type = 'post', unset = []) => bpMutate([{patch: {id, type, set, unset}}, {publish: {id, type}}]).then(() => {}),
  discardDraft: (id, type) => bpMutate([{discardDraft: {id, type}}]).then(() => {}, () => {}),
  // Ours reads Barkpark's history and catches up in the panel itself (J15, #460).
  historyReady: async () => true,
}

/**
 * A Barkpark-only fixture doc (fixtures/barkpark-only.ndjson) back as seeded: the draft
 * dropped, the doc replaced and published. A paper's block list follows its body (a
 * patch of `body` alone leaves the blocks the canvas wrote).
 */
export async function resetNative(id: string, type: string) {
  const line = readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"_id": "${id}"`))
  if (!line) throw new Error(`${id} is not in fixtures/barkpark-only.ndjson`)
  await bpMutate([{discardDraft: {id, type}}]).catch(() => {})
  await bpMutate([{createOrReplace: JSON.parse(line)}, {publish: {id, type}}])
}

export const target = (info: TestInfo): Target => (info.project.name === 'sanity' ? sanity : studio)

/** With dev sign-in on (STUDIO_DEV_LOGIN=1), ours asks who you are first: answer as editor A. */
export async function signInIfAsked(page: Page, email = 'studio-editor-a@example.com') {
  if (!page.url().includes('/login')) return
  await page.locator('html[data-hydrated]').waitFor({state: 'attached'}) // typing before hydration is lost
  await page.locator('#email').fill(email)
  await page.getByRole('button', {name: 'Sign in'}).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

/** expect.poll on the backend: ask every 250 ms, not the default's 1 s steps (keeps CI near its budget). */
export const BACKEND_POLL = {timeout: 10_000, intervals: [100, 250]}
