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
  /** The "…" actions button of a reference field showing a value. */
  refMenu(pane: Locator, field: string): Locator
  /** Write straight to the backend over HTTP, as another client would. */
  patch(id: string, set: Record<string, unknown>, type?: string): Promise<void>
  /** A reference value in this backend's shape. */
  ref(id: string): unknown
  /** Delete a document (draft and published) a test created. */
  deleteDoc(id: string, type: string): Promise<void>
  /** Drop drafts a test left behind and restore published values. */
  restore(id: string, set: Record<string, unknown>, type?: string): Promise<void>
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
  refMenu: (pane, field) =>
    pane
      .locator(`a[href$="parentRefPath%3D${encodeURIComponent(field)}"]`)
      .first()
      .locator('xpath=ancestor::*[.//button[.//*[@data-sanity-icon="ellipsis-horizontal"]]][1]')
      .locator('button:has([data-sanity-icon="ellipsis-horizontal"])')
      .first(),
  ref: (id) => ({_type: 'reference', _ref: id}),
  deleteDoc: (id) => sanityMutate([{delete: {id: `drafts.${id}`}}, {delete: {id}}]).then(() => {}),
  patch: (id, set) => sanityMutate([{patch: {id, set}}]).then(() => {}),
  restore: (id, set) => sanityMutate([{delete: {id: `drafts.${id}`}}, {patch: {id, set}}]).then(() => {}),
}

const bpBase = () => `${need('BARKPARK_URL')}/w/${need('BARKPARK_WORKSPACE')}/p/${process.env.BARKPARK_PROJECT || 'default'}`
const bpDataset = () => process.env.BARKPARK_DATASET || 'production'
const bpMutate = (mutations: unknown[]) =>
  fetch(`${bpBase()}/v1/data/mutate/${bpDataset()}`, {
    method: 'POST',
    headers: {authorization: `Bearer ${need('BARKPARK_TOKEN')}`, 'content-type': 'application/json'},
    body: JSON.stringify({mutations}),
  }).then(ok)

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
  refMenu: (pane, field) =>
    pane
      .locator('.ref-row')
      .filter({has: pane.page().locator(`a[href$="parentRefPath=${encodeURIComponent(field)}"]`)})
      .getByRole('button', {name: 'Reference actions'}),
  ref: (id) => id,
  deleteDoc: (id, type) => bpMutate([{delete: {id, type}}]).then(() => {}),
  // Barkpark: a patch on a published doc writes its draft; publish lands it like an HTTP client would.
  patch: (id, set, type = 'post') => bpMutate([{patch: {id, type, set}}, {publish: {id, type}}]).then(() => {}),
  restore: (id, set, type = 'post') => bpMutate([{patch: {id, type, set}}, {publish: {id, type}}]).then(() => {}),
}

export const target = (info: TestInfo): Target => (info.project.name === 'sanity' ? sanity : studio)
