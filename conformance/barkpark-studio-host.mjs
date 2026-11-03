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
const REPORT = new URL('./barkpark-studio-host.json', import.meta.url).pathname
const ELLIPSIS =
  '<svg width="25" height="25" viewBox="0 0 25 25" fill="none"><path d="M6.5 11C7.32843 11 8 11.6716 8 12.5C8 13.3284 7.32843 14 6.5 14C5.67157 14 5 13.3284 5 12.5C5 11.6716 5.67157 11 6.5 11Z" fill="currentColor"></path><path d="M12.5 11C13.3284 11 14 11.6716 14 12.5C14 13.3284 13.3284 14 12.5 14C11.6716 14 11 13.3284 11 12.5C11 11.6716 11.6716 11 12.5 11Z" fill="currentColor"></path><path d="M18.5 11C19.3284 11 20 11.6716 20 12.5C20 13.3284 19.3284 14 18.5 14C17.6716 14 17 13.3284 17 12.5C17 11.6716 17.6716 11 18.5 11Z" fill="currentColor"></path></svg>'
let PortableDocView
let imageFileName

function rendered(html) {
  const document = new Window().document
  document.body.innerHTML = html
  const view = document.body.querySelector('.portable-doc-view')
  return {document, nodes: view?.childNodes ?? document.body.childNodes}
}

function exactAttribute(errors, element, name, expected, path) {
  const actual = element?.getAttribute(name) ?? null
  if (actual !== expected) errors.push(`${path}: attr ${name} ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
}

function validateCaret(golden, output, errors) {
  const root = [...output.nodes].find((node) => node.nodeType === 1)
  const expected = typeof golden.input?.id === 'string' ? golden.input.id : null
  exactAttribute(errors, root, 'data-bp-id', expected, 'host caret root')
  if (root) root.removeAttribute('data-bp-id')
}

function validateImageCard(golden, output, errors) {
  if (golden.type !== 'image') return
  const root = [...output.nodes].find((node) => node.nodeType === 1)
  if (!root || root.localName !== 'figure' || root.className !== 'pd-image') {
    errors.push('host image card: root is not exactly figure.pd-image')
    return
  }
  const children = [...root.children]
  const [head, image] = children
  if (children.length !== 2 || head?.localName !== 'div' || head.className !== 'pd-image-head' || image?.localName !== 'img') {
    errors.push('host image card: expected exactly .pd-image-head followed by the canonical img')
    return
  }
  const [name, more] = [...head.children]
  const src = typeof golden.input.src === 'string' ? golden.input.src : typeof golden.input.url === 'string' ? golden.input.url : ''
  const alt = typeof golden.input.alt === 'string' ? golden.input.alt : ''
  const expectedName = imageFileName(src, alt, 'Image')
  if (head.children.length !== 2 || name?.localName !== 'span' || name.className !== 'pd-image-name' || name.textContent !== expectedName)
    errors.push(`host image card: exact name ${JSON.stringify(expectedName)} is absent`)
  if (more?.localName !== 'span' || more.className !== 'pd-image-more' || more.getAttribute('aria-hidden') !== 'true' || more.innerHTML !== ELLIPSIS)
    errors.push('host image card: exact inert ellipsis action is absent')
  root.replaceWith(image)
}

function validateNativeLinks(expected, output, errors) {
  const goldenLinks = [...expected.document.querySelectorAll('a')]
  const actualLinks = [...output.document.querySelectorAll('a')]
  if (actualLinks.length !== goldenLinks.length) {
    errors.push(`host links: ${actualLinks.length} anchors != canonical ${goldenLinks.length}`)
    return
  }
  for (let index = 0; index < goldenLinks.length; index++) {
    const golden = goldenLinks[index]
    const actual = actualLinks[index]
    const target = golden.getAttribute('target')
    const rel = golden.getAttribute('rel')
    const external = /^https?:\/\//.test(golden.getAttribute('href') ?? '')
    const expectedTarget = target ?? (external ? '_blank' : null)
    const expectedRel = rel ?? (external ? 'noopener noreferrer' : null)
    exactAttribute(errors, actual, 'target', expectedTarget, `host link ${index}`)
    exactAttribute(errors, actual, 'rel', expectedRel, `host link ${index}`)
    target === null ? actual.removeAttribute('target') : actual.setAttribute('target', target)
    rel === null ? actual.removeAttribute('rel') : actual.setAttribute('rel', rel)
  }
}

function judge(golden) {
  const actual = renderToStaticMarkup(createElement(PortableDocView, {blocks: [golden.input]}))
  const output = rendered(actual)
  if (output.document.querySelector('.bp-unknown-block')) return MISSING
  const expected = rendered(golden.expectedHtml)
  const errors = []
  validateCaret(golden, output, errors)
  validateImageCard(golden, output, errors)
  validateNativeLinks(expected, output, errors)
  return [...errors, ...diffShapes(shapeOf(output.nodes), shapeOf(expected.nodes))]
}

async function main() {
  const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'})
  try {
    ;({PortableDocView} = await vite.ssrLoadModule('/src/components/PortableDocView.tsx'))
    ;({imageFileName} = await vite.ssrLoadModule('/src/lib/image.ts'))
    const report = await conform({
      renderer: 'barkpark-studio-host',
      compare: 'host-contract-then-dom',
      judge,
      pack: process.env.CONFORMANCE_PACK || PACK,
    })
    const problems = settle(report, {...modeFromEnv(), path: REPORT})
    const result = counts(report)
    console.log(
      `barkpark-studio-host: ${result.pass} pass, ${result.fail} fail, ${result.missing} missing, ${result.unchecked} unchecked of ${report.rows.length}`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = problems.length ? 1 : 0
  } catch (error) {
    console.error(`barkpark-studio-host: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  } finally {
    await vite.close()
  }
}

void main()
