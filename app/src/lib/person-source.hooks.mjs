// Module hooks for person-source.test.ts: lib/person-source.ts runs as it is, with lib/session.ts
// swapped for who-am-I's query alone (lib/me-query.ts, as session.ts makes it), its answer an
// editor's. Imports without an extension resolve to the .ts file, as Vite does.
const STUB = {
  '/src/lib/session.ts': `
    import {meQueryOf} from './me-query.ts'
    const asked = meQueryOf(async () => ({email: 'ada@example.com', name: 'Ada', userId: 'u1', role: 'member', canWrite: true}))
    export const meQuery = asked.query
    export const madeBySession = asked.isMade`,
}
const pathOf = (url) => (url.startsWith('file:') ? new URL(url).pathname : url)
const stubOf = (url) => Object.keys(STUB).find((k) => url.startsWith('file:') && pathOf(url).endsWith(k))

export async function resolve(specifier, context, next) {
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
