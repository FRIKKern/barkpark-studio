// Module hooks for save-flow.test.ts: lib/edits.ts runs as it is, with its server side (the
// studio's server functions, Barkpark, the session) and the document read swapped for a
// Barkpark kept in memory by the test (globalThis.saveFlowServer). Imports without an
// extension resolve to the .ts file, as Vite does. `?page=…` on an import gives a page of its
// own: every module it imports again, as a reload does (the stubs and the server are shared).
// edit-bases.ts's rebase() also notes each time it comes to merge a field (one this editor
// changed, another version of it from the server): the revision and the base it merges from
// (globalThis.saveFlowMerges).
const STUB = {
  '@tanstack/react-start': `
    const chain = {validator: () => chain, handler: (h) => (opts) => h({data: opts?.data})}
    export const createServerFn = () => chain`,
  '@tanstack/react-start/server': `export const getRequest = () => ({}); export const getCookie = () => undefined`,
  '/src/server/barkpark.ts': `
    export const bpFetch = (...a) => globalThis.saveFlowServer.fetch(new URL(import.meta.url).search, ...a)
    export const dataset = () => 'e2e-local'
    export const requestToken = () => 'test'
    export const underPressure = () => false`,
  '/src/server/write-faults.ts': `export const writeFaultFor = () => null`,
  '/src/server/auth.ts': `export const currentEditor = () => null; export const signOut = async () => {}`,
  '/src/server/listen.ts': `export const expectEcho = () => {}; export const mutatedIds = () => []`,
  '/src/server/client-gone.ts': `export const clientGone = () => null`,
  '/src/components/Toasts.tsx': `export const toast = () => {}`,
  '/src/lib/i18n.tsx': `
    export const t = (s, v = {}) => s.replace(/\\{(\\w+)\\}/g, (_, k) => String(v[k] ?? ''))
    export const translate = t
    export const localeQuery = {queryKey: ['locale'], queryFn: () => globalThis.saveFlowLocale?.() ?? Promise.resolve({locale: 'en'})}`,
  '/src/lib/data.ts': `
    export const readServerDoc = (...a) => globalThis.saveFlowServer.read(new URL(import.meta.url).search, ...a)
    export const schemasQuery = {queryKey: ['schemas']}
    export const docQuery = (id) => ({queryKey: ['doc', id]})
    export const setUnsavedOverlay = () => {}`,
}
const TRACE = `
export function rebase(e, d, was) {
  for (const [f, base] of e.base) {
    const theirs = getPath(d, f)
    if (same(theirs, base) || !e.dirty.has(f) || e.inflight?.has(f)) continue
    ;(globalThis.saveFlowMerges ??= []).push({page: new URL(import.meta.url).search, rev: d._rev, field: f, base: JSON.stringify(base)})
  }
  return rebase__(e, d, was)
}`
const pathOf = (url) => (url.startsWith('file:') ? new URL(url).pathname : url)
const stubOf = (url) => Object.keys(STUB).find((k) => (k.startsWith('/') ? url.startsWith('file:') && pathOf(url).endsWith(k) : url === `stub:${k}`))

export async function resolve(specifier, context, next) {
  if (STUB[specifier] !== undefined && !specifier.startsWith('/')) return {url: `stub:${specifier}`, shortCircuit: true}
  const page = context.parentURL?.startsWith('file:') ? new URL(context.parentURL).searchParams.get('page') : null
  const withPage = (r) => (page && specifier.startsWith('.') && r.url.startsWith('file:') && !r.url.includes('/node_modules/') ? {...r, url: `${r.url.split('?')[0]}?page=${page}`} : r)
  try {
    return withPage(await next(specifier, context))
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw err
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      try {
        return withPage(await next(specifier + ext, context))
      } catch {}
    }
    throw err
  }
}

export async function load(url, context, next) {
  const stub = stubOf(url)
  if (stub) return {format: 'module', source: STUB[stub], shortCircuit: true}
  const r = await next(url, context)
  if (!pathOf(url).endsWith('/src/lib/edit-bases.ts')) return r
  return {...r, source: String(r.source).replace('export function rebase(', 'function rebase__(') + TRACE}
}
