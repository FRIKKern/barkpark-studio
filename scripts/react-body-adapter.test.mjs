import assert from 'node:assert/strict'
import {after, before, test} from 'node:test'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'

const appPackage = new URL('../app/package.json', import.meta.url)
const require = createRequire(appPackage)
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const {Window} = await load('happy-dom')
const {createServer} = await load('vite')
let renderPortableDocView
let renderPortableDocument
let vite

before(async () => {
  vite = await createServer({root: new URL('../app/', import.meta.url).pathname, server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'})
  ;({renderPortableDocView} = await vite.ssrLoadModule('/src/components/PortableDocView.tsx'))
  ;({renderPortableDocument} = await load('@portable-doc/react'))
})

after(async () => {
  await vite.close()
})

test('the read-only adapter ignores malformed blocks while preserving valid siblings', () => {
  const html = renderPortableDocView([
    null,
    3,
    'not a block',
    [],
    {id: 'bad-items', type: 'list', items: {0: [{type: 'constructor', text: 'not iterable'}]}},
    {id: 'good', type: 'paragraph', items: null, content: [{text: 'ignored registry key'}, {type: 'constructor', text: 'kept'}]},
  ], false, [], (value) => value)
  const document = new Window().document
  document.body.innerHTML = html
  assert.match(document.querySelector('[data-bp-id="good"]')?.textContent ?? '', /kept/)
  assert.equal(document.querySelector('.inline-object')?.getAttribute('data-type'), 'constructor')
})

test('host attributes remain inert and prototype-named registries use own entries', () => {
  const badId = `p" $& $' data-evil="yes`
  const badDoc = 'doc" onmouseover="boom'
  const badSrc = 'https://example.invalid/pic.png" onerror="boom'
  const badAlt = 'alt" autofocus onfocus="boom'
  const html = renderPortableDocView([
    {id: badId, type: 'paragraph', content: [
      {type: 'wikilink', docId: badDoc, children: [{type: 'text', value: 'Go'}]},
      {type: 'constructor', text: 'Ctor'},
      {type: 'toString', text: 'String'},
      {type: '__proto__', text: 'Proto'},
    ]},
    {id: 'image', type: 'image', src: badSrc, alt: badAlt},
    {id: 'object', type: '__proto__', label: 'Object proto'},
  ], true, [{name: '__proto__', fields: [{name: 'label', type: 'text'}]}], (value) => value)
  const document = new Window().document
  document.body.innerHTML = html
  assert.equal(document.querySelector('p')?.getAttribute('data-bp-id'), badId)
  assert.equal(document.querySelector('.wikilink')?.getAttribute('data-doc-id'), badDoc)
  assert.deepEqual([...document.querySelectorAll('.inline-object')].map((node) => node.getAttribute('data-type')), ['constructor', 'toString', '__proto__'])
  assert.equal(document.querySelector('.pd-object')?.getAttribute('data-object-type'), '__proto__')
  assert.equal(document.querySelector('.pd-image img')?.getAttribute('src'), badSrc)
  assert.equal(document.querySelector('.pd-image img')?.getAttribute('alt'), badAlt)
  assert.equal(document.querySelectorAll('[data-evil],[onmouseover],[onerror],[onfocus],[autofocus]').length, 0)
})

test('field and embed opt-ins render while callouts stay canonical and safe external links remain native', () => {
  const html = renderPortableDocView([
    {type: 'field-string', label: 'Title', value: 'Hello'},
    {type: 'embed', target: 'paper-1'},
    {type: 'callout', tone: 'info', content: [{type: 'text', value: 'Notice'}]},
    {type: 'paragraph', content: [
      {type: 'link', href: '/inside', children: [{type: 'text', value: 'Inside'}]},
      {type: 'text', value: ' '},
      {type: 'link', href: 'https://example.com', children: [{type: 'text', value: 'Outside'}]},
      {type: 'text', value: ' '},
      {type: 'link', href: 'HTTPS://EXAMPLE.COM/UPPER', children: [{type: 'text', value: 'Upper'}]},
      {type: 'text', value: ' '},
      {type: 'link', href: 'javascript:alert(1)', children: [{type: 'text', value: 'Unsafe'}]},
    ]},
  ], false, [], (value) => value)
  const document = new Window().document
  document.body.innerHTML = html
  assert.equal(document.querySelectorAll('.bp-unknown-block').length, 0)
  assert.equal(document.querySelector('.bp-field__v')?.textContent, 'Hello')
  assert.equal(document.querySelector('.paper-embed')?.getAttribute('data-embed'), 'paper-1')
  assert.equal(document.querySelector('.bp-callout')?.classList.contains('callout'), false)
  const [inside, outside, upper, unsafe] = document.querySelectorAll('a')
  assert.equal(inside.getAttribute('target'), null)
  assert.equal(outside.getAttribute('target'), '_blank')
  assert.equal(outside.getAttribute('rel'), 'noopener noreferrer')
  assert.equal(upper.getAttribute('target'), '_blank')
  assert.equal(upper.getAttribute('rel'), 'noopener noreferrer')
  assert.equal(unsafe.getAttribute('href'), '#')
  assert.equal(unsafe.getAttribute('target'), null)
})

test('the image card embeds canonical image output while preserving inline and legacy sources', () => {
  const ordinary = {id: 'ordinary', type: 'image', src: 'https://example.com/image.png', alt: 'Ordinary', width: 120, height: 80}
  const inline = {id: 'inline', type: 'image', src: 'data:image/png;base64,AA==', alt: 'Inline', width: 2, height: 3}
  const legacy = {id: 'legacy', type: 'image', url: 'https://example.com/legacy.png', alt: 'Legacy', width: 40}
  const document = new Window().document
  document.body.innerHTML = renderPortableDocView([ordinary, inline, legacy], false, [], (value) => value)
  const images = [...document.querySelectorAll('.pd-image img')]
  assert.equal(images.length, 3)
  const canonical = new Window().document
  canonical.body.innerHTML = renderPortableDocument([ordinary])
  assert.equal(images[0].outerHTML, canonical.querySelector('img')?.outerHTML)
  assert.equal(images[0].getAttribute('data-bp-lightboxable'), 'true')
  assert.equal(images[0].getAttribute('style'), 'max-width:100%;height:auto')
  assert.equal(images[0].getAttribute('width'), '120')
  assert.equal(images[0].getAttribute('height'), '80')
  assert.equal(images[1].getAttribute('src'), inline.src)
  assert.equal(images[1].getAttribute('width'), '2')
  assert.equal(images[2].getAttribute('src'), legacy.url)
  assert.equal(document.querySelector('[data-bp-id="ordinary"]')?.classList.contains('pd-image'), true)
})
