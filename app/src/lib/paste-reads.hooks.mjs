// Module hooks for paste-reads.test.ts: lib/paste-reads.ts and the roles read run as they are,
// the server function in-process, with Barkpark, the session and the schemas swapped for the
// test's (globalThis.pasteReads: {editor, fetch}). Imports without an extension resolve to the
// .ts file, as Vite does.
const STUB = {
  '@tanstack/react-start': `
    const chain = {validator: () => chain, handler: (h) => (opts) => h({data: opts?.data})}
    export const createServerFn = () => chain`,
  '/src/server/auth.ts': `export const currentEditor = () => globalThis.pasteReads.editor`,
  '/src/server/barkpark.ts': `export const bpFetch = (...a) => globalThis.pasteReads.fetch(...a)`,
  '/src/lib/data.ts': `export const schemasQuery = {queryKey: ['schemas'], queryFn: async () => []}`,
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
  return stub ? {format: 'module', source: STUB[stub], shortCircuit: true} : next(url, context)
}
