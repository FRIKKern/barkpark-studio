// Module hooks for doc-read-fresh.test.ts: lib/data.ts's document read runs as it is, the
// server function in-process, with Barkpark swapped for the test's (globalThis.docRead.fetch,
// given bpFetch's own arguments). Imports without an extension resolve to the .ts file, as Vite does.
const STUB = {
  '@tanstack/react-start': `
    const chain = {validator: () => chain, handler: (h) => (opts) => h({data: opts?.data})}
    export const createServerFn = () => chain`,
  '@tanstack/react-start/server': `export const getCookie = () => undefined; export const setCookie = () => {}; export const deleteCookie = () => {}; export const getRequest = () => ({headers: new Headers()})`,
  '/src/server/barkpark.ts': `
    export const bpFetch = (...a) => globalThis.docRead.fetch(...a)
    export const dataset = () => 'e2e-local'
    export const requestToken = () => 'test'
    export const scope = () => ({workspace: 'ws', project: 'p', dataset: 'e2e-local'})
    export const apiBase = () => 'http://barkpark.test'; export const READ_DEDUPE_MS = 500
    export const bpRoot = (...a) => globalThis.docRead.fetch(...a)
    export const serviceToken = async () => 'test'; export const contentModelToken = () => 'test'
    export const workspaceLocale = async () => ({}); export const underPressure = () => false
    export const forgetReads = () => {}; export const forgetMemberReads = () => {}; export const forgetReadsOf = () => {}`,
  '/src/components/Toasts.tsx': `export const toast = () => {}; export const stickyToast = () => {}`,
  '/src/server/listen.ts': `export const resumeMark = () => undefined`,
  '/src/server/schemas.ts': `
    export const fieldIcons = () => ({}); export const schemaIcon = () => undefined; export const STUDIO_TYPES = []
    export const readDesk = async () => null; export const readRest = async () => []; export const readSchemas = async () => []`,
  '/src/lib/i18n.tsx': `
    export const translate = (_locale, s) => s; export const t = (s) => s; export const useT = () => t
    export const localeQuery = {queryKey: ['locale'], queryFn: async () => ({locale: 'en'})}
    export const collate = (a, b) => String(a).localeCompare(String(b))`,
}
const pathOf = (url) => (url.startsWith('file:') ? new URL(url).pathname : url)
const stubOf = (url) => Object.keys(STUB).find((k) => (k.startsWith('/') ? url.startsWith('file:') && pathOf(url).endsWith(k) : url === `stub:${k}`))

export async function resolve(specifier, context, next) {
  if (STUB[specifier] !== undefined && !specifier.startsWith('/')) return {url: `stub:${specifier}`, shortCircuit: true}
  try {
    return await next(specifier, context)
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw err
    for (const ext of ['.ts', '.tsx']) {
      try {
        return await next(specifier + ext, context)
      } catch {}
    }
    throw err
  }
}

export async function load(url, context, next) {
  const stub = stubOf(url)
  if (stub) return {format: 'module', source: STUB[stub], shortCircuit: true}
  // Vite's import.meta.env, which node has not: a dev build (as describe-token.hooks.mjs gives it).
  const r = await next(url, context)
  return url.startsWith('file:') && /\/src\/server\/[\w-]+\.ts$/.test(pathOf(url)) ? {...r, source: `import.meta.env = {PROD: false, DEV: true};\n${r.source}`} : r
}
