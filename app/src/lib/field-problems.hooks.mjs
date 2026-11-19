// Module hooks for field-problems.test.ts: components/Fields.tsx runs as it is, as the server build
// has it. The app's own TS and TSX go through Vite's own transform (oxc: types out, JSX in React's
// automatic runtime), with `import.meta.env` the server build's (SSR), JSON as a module and a
// stylesheet as nothing.
// Imports without an extension resolve to the .ts or .tsx file, as Vite does.
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {transformWithOxc} from 'vite'

const ENV = '({PROD: false, DEV: true, SSR: true, MODE: "test", BASE_URL: "/"})'
const ours = (url) => url.startsWith('file:') && !url.includes('/node_modules/')

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
  if (ours(url) && /\.tsx?$/.test(url)) {
    const path = fileURLToPath(url)
    const {code} = await transformWithOxc(readFileSync(path, 'utf8').replaceAll('import.meta.env', ENV), path, {jsx: {runtime: 'automatic'}})
    return {format: 'module', source: code, shortCircuit: true}
  }
  if (ours(url) && url.endsWith('.json')) return {format: 'module', source: `export default ${readFileSync(fileURLToPath(url), 'utf8')}`, shortCircuit: true}
  // A stylesheet the bundler would add to the page: nothing for a render test.
  if (ours(url) && /\.css(\?.*)?$/.test(url)) return {format: 'module', source: 'export default ""', shortCircuit: true}
  return next(url, context)
}
