import {readFileSync} from 'node:fs'
import type {BrowserContext, Locator, Page, TestInfo} from '@playwright/test'

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
  docValue(id: string, field: string): Promise<unknown>
  /** Put a seed document back exactly as fixtures/seed.ndjson has it, no draft. */
  resetDoc(id: string, type: string): Promise<void>
  /** The title of the published version, straight from the backend. */
  publishedTitle(id: string): Promise<string | undefined>
  /** Delete a document (draft and published) a test created. */
  deleteDoc(id: string, type: string): Promise<void>
  /** Drop drafts a test left behind and restore published values. */
  restore(id: string, set: Record<string, unknown>, type?: string, unset?: string[]): Promise<void>
}

const need = (k: string) => process.env[k] ?? fail(`missing ${k} in ../.env`)
function fail(msg: string): never {
  throw new Error(msg)
}

async function ok(res: Response) {
  if (!res.ok) throw new Error(`${res.url} → ${res.status} ${await res.text()}`)
  return res
}

const SANITY_API = 'https://0ozn679s.api.sanity.io/v2025-02-19/data/mutate/production'
const sanityMutate = (mutations: unknown[]) =>
  fetch(SANITY_API, {
    method: 'POST',
    headers: {authorization: `Bearer ${need('SANITY_TOKEN')}`, 'content-type': 'application/json'},
    body: JSON.stringify({mutations}),
  }).then(ok)

const sanity: Target = {
  name: 'sanity',
  async prepare(ctx) {
    await ctx.addInitScript((token) => {
      localStorage.setItem('__studio_auth_token_0ozn679s', JSON.stringify({token, time: new Date().toISOString()}))
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
    const r = await fetch(`https://0ozn679s.api.sanity.io/v2025-02-19/data/query/production?query=${q}&perspective=raw`, {
      headers: {authorization: `Bearer ${need('SANITY_TOKEN')}`},
    }).then(ok)
    const rows = ((await r.json()) as {result: {_id: string; title: string}[]}).result
    return {draft: rows.find((x) => x._id.startsWith('drafts.'))?.title, published: rows.find((x) => x._id === id)?.title}
  },
  docValue: async (id, field) => {
    const q = encodeURIComponent(`coalesce(*[_id == "drafts.${id}"][0], *[_id == "${id}"][0]).${field}`)
    const r = await fetch(`https://0ozn679s.api.sanity.io/v2025-02-19/data/query/production?query=${q}&perspective=raw`, {
      headers: {authorization: `Bearer ${need('SANITY_TOKEN')}`},
    }).then(ok)
    return ((await r.json()) as {result: unknown}).result
  },
  resetDoc: async (id) => {
    const seed = readFileSync(new URL('../../fixtures/seed.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((d) => d._id === id)
    await sanityMutate([{delete: {id: `drafts.${id}`}}, {createOrReplace: seed}])
  },
  publishedTitle: async (id) => {
    const q = encodeURIComponent(`*[_id == "${id}"][0].title`)
    const r = await fetch(`https://0ozn679s.api.sanity.io/v2025-02-19/data/query/production?query=${q}&perspective=published`, {
      headers: {authorization: `Bearer ${need('SANITY_TOKEN')}`},
    }).then(ok)
    return ((await r.json()) as {result?: string}).result
  },
  deleteDoc: (id) => sanityMutate([{delete: {id: `drafts.${id}`}}, {delete: {id}}]).then(() => {}),
  patch: (id, set) => sanityMutate([{patch: {id, set}}]).then(() => {}),
  restore: (id, set, _type, unset = []) => sanityMutate([{delete: {id: `drafts.${id}`}}, {patch: {id, set, unset}}]).then(() => {}),
}

const bpBase = () => `${need('BARKPARK_URL')}/w/${need('BARKPARK_WORKSPACE')}/p/${process.env.BARKPARK_PROJECT || 'default'}`
// A project may name its own dataset (CI splits the suite over two workers, each
// with its own studio server and dataset). A worker runs one test at a time, so
// the project of the test in hand decides.
let projectDataset: string | undefined
const bpDataset = () => projectDataset || process.env.BARKPARK_DATASET || 'production'
// Two first patches on a published doc race to fork its draft and one gets 422
// "doc_id has already been taken" (task-324b4d00706a6cfb); the rig retries once.
const bpMutate = async (mutations: unknown[], retry = true): Promise<Response> => {
  const res = await fetch(`${bpBase()}/v1/data/mutate/${bpDataset()}`, {
    method: 'POST',
    headers: {authorization: `Bearer ${need('BARKPARK_TOKEN')}`, 'content-type': 'application/json'},
    body: JSON.stringify({mutations}),
  })
  if (retry && res.status === 422) return new Promise((r) => setTimeout(() => r(bpMutate(mutations, false)), 300))
  return ok(res)
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
  docValue: async (id, field) => {
    const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/post/${encodeURIComponent(id)}?perspective=drafts`, {headers: {authorization: `Bearer ${need('BARKPARK_TOKEN')}`}})
    return r.ok ? ((await r.json()) as {result: Record<string, unknown>}).result[field] : undefined
  },
  resetDoc: async (id, type) => {
    const seed = readFileSync(new URL('../../fixtures/seed.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((d) => d._id === id)
    // Put back the seed's plain fields the journeys edit, and publish.
    await bpMutate([{patch: {id, type, set: {title: seed.title, seo: seed.seo, rating: seed.rating}}}, {publish: {id, type}}])
  },
  publishedTitle: async (id) => {
    const r = await fetch(`${bpBase()}/v1/data/doc/${bpDataset()}/post/${id}?perspective=published`, {
      headers: {authorization: `Bearer ${need('BARKPARK_TOKEN')}`},
    }).then(ok)
    return ((await r.json()) as {result?: {title?: string}}).result?.title
  },
  deleteDoc: (id, type) => bpMutate([{delete: {id, type}}]).then(() => {}, () => {}), // gone already is fine
  // Barkpark: a patch on a published doc writes its draft; publish lands it like an HTTP client would.
  patch: (id, set, type = 'post') => bpMutate([{patch: {id, type, set}}, {publish: {id, type}}]).then(() => {}),
  restore: (id, set, type = 'post', unset = []) => bpMutate([{patch: {id, type, set, unset}}, {publish: {id, type}}]).then(() => {}),
}

export function target(info: TestInfo): Target {
  projectDataset = (info.project.metadata as {dataset?: string} | undefined)?.dataset
  return info.project.name === 'sanity' ? sanity : studio
}
