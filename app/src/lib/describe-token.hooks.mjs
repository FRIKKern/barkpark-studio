// Module hooks for describe-token.test.ts: server/auth.ts runs as it is, with the request
// (cookies) and the scope swapped for the test's, and Vite's import.meta.env a dev server's.
// Barkpark is the test's global fetch.
// Imports without an extension resolve to the .ts file, as Vite does.
const STUB = {
  '@tanstack/react-start/server-only': ``,
  '@tanstack/react-start/server': `export const getCookie = () => undefined; export const setCookie = () => {}; export const deleteCookie = () => {}; export const getRequest = () => ({headers: new Headers()})`,
  '/src/server/barkpark.ts': `export const scope = () => ({workspace: 'ws', project: 'p', dataset: 'e2e-local'})`,
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
  const r = await next(url, context)
  // Vite's import.meta.env, as a dev server has it.
  return pathOf(url).endsWith('/src/server/auth.ts') ? {...r, source: `import.meta.env = {PROD: false, DEV: true};\n${r.source}`} : r
}
