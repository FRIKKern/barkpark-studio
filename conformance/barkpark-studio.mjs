import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'

import {MISSING, conform, counts, diffShapes, modeFromEnv, settle, shapeOf} from './pack/conformance.mjs'

const require = createRequire(new URL('../app/package.json', import.meta.url))
const load = (specifier) => import(pathToFileURL(require.resolve(specifier)).href)
const {createElement} = await load('react')
const {renderToStaticMarkup} = await load('react-dom/server')
const {Window} = await load('happy-dom')
const {createServer} = await load('vite')

const PACK = new URL('./pack/goldens', import.meta.url).pathname
const REPORT = new URL('./barkpark-studio.json', import.meta.url).pathname
const KNOWN_TYPES = new Set(['blockquote', 'callout', 'heading', 'image', 'list', 'paragraph', 'pullquote'])
let PortableDocView

function nodesOf(html) {
  const document = new Window().document
  document.body.innerHTML = html
  return document.body.childNodes
}

function judge(golden) {
  if (!KNOWN_TYPES.has(golden.type)) return MISSING
  const actual = renderToStaticMarkup(createElement(PortableDocView, {blocks: [golden.input]}))
  return diffShapes(shapeOf(nodesOf(actual)), shapeOf(nodesOf(golden.expectedHtml)))
}

async function main() {
  const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'})
  try {
    ;({PortableDocView} = await vite.ssrLoadModule('/src/components/PortableDocView.tsx'))
    const report = await conform({
      renderer: 'barkpark-studio',
      compare: 'dom',
      judge,
      pack: process.env.CONFORMANCE_PACK || PACK,
    })
    const problems = settle(report, {...modeFromEnv(), path: REPORT})
    const result = counts(report)
    console.log(
      `barkpark-studio: ${result.pass} pass, ${result.fail} fail, ${result.missing} missing, ${result.unchecked} unchecked of ${report.rows.length}`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = problems.length ? 1 : 0
  } catch (error) {
    console.error(`barkpark-studio: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  } finally {
    await vite.close()
  }
}

void main()
