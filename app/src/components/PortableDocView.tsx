import {
  renderPortableDocument,
  type Block as PortableBlock,
  type CoreBlockRenderer,
  type InlineObjectRenderer,
  type PortableDocProps,
} from '@portable-doc/react'
import {embedBlocks} from '@portable-doc/react/embed'
import {fieldBlocks} from '@portable-doc/react/field-blocks'
import {useT} from '../lib/i18n'
import {imageFileName} from '../lib/image'
import {objectBlockTitle, type ObjectKind} from '../lib/object-block'

// A PortableDoc block list drawn read-only (J10): the body field before its canvas
// is activated, and anywhere a body is only shown. Host hooks keep Studio's card,
// caret and navigation DOM while the canonical package owns the document walk.

type Inline = {
  type: string
  value?: string
  text?: string
  docId?: string
  children?: Inline[]
  attrs?: Record<string, unknown>
}
type Block = PortableBlock & {id: string; content?: Inline[]; items?: Inline[][]}

const DOCUMENT_ICON =
  '<svg width="25" height="25" viewBox="0 0 25 25" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M11.5 4.5V9.5H6.5"></path><path d="M18.5 20.5H6.5V9.5L11.5 4.5H18.5V20.5Z"></path></svg>'
const ELLIPSIS =
  '<svg width="25" height="25" viewBox="0 0 25 25" fill="none"><path d="M6.5 11C7.32843 11 8 11.6716 8 12.5C8 13.3284 7.32843 14 6.5 14C5.67157 14 5 13.3284 5 12.5C5 11.6716 5.67157 11 6.5 11Z" fill="currentColor"></path><path d="M12.5 11C13.3284 11 14 11.6716 14 12.5C14 13.3284 13.3284 14 12.5 14C11.6716 14 11 13.3284 11 12.5C11 11.6716 11.6716 11 12.5 11Z" fill="currentColor"></path><path d="M18.5 11C19.3284 11 20 11.6716 20 12.5C20 13.3284 19.3284 14 18.5 14C17.6716 14 17 13.3284 17 12.5C17 11.6716 17.6716 11 18.5 11Z" fill="currentColor"></path></svg>'

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

function inlineObjectTypes(blocks: unknown): string[] {
  const found = new Set<string>()
  const visit = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return
    for (const value of nodes) {
      if (!value || typeof value !== 'object') continue
      const node = value as Inline
      if (typeof node.type === 'string' && node.type !== 'text' && !node.children && typeof node.text === 'string') found.add(node.type)
      visit(node.children)
    }
  }
  if (!Array.isArray(blocks)) return []
  for (const value of blocks) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const block = value as Block
    visit(block.content)
    if (Array.isArray(block.items)) for (const item of block.items) visit(item)
  }
  return [...found]
}

function docId(node: Record<string, unknown>): string | undefined {
  if (typeof node.docId === 'string') return node.docId
  return node.attrs && typeof node.attrs === 'object' && typeof (node.attrs as {docId?: unknown}).docId === 'string'
    ? (node.attrs as {docId: string}).docId
    : undefined
}

function externalLinks(html: string): string {
  return html.replace(/<a href="(https?:\/\/[^"]*)"([^>]*)>/gi, (whole, href: string, attrs: string) =>
    /\starget=/.test(attrs)
      ? whole
      : `<a href="${href}"${attrs} target="_blank" rel="noopener noreferrer">`,
  )
}

/** Pure inner HTML form, exported so the candidate adapter can be contract-tested. */
export function renderPortableDocView(
  blocks: Block[],
  linksOpen: boolean,
  objects: ObjectKind[],
  t: (key: string) => string,
): string {
  const extensionBlocks = Object.assign(Object.create(null), fieldBlocks, embedBlocks()) as NonNullable<PortableDocProps['blocks']>
  const blockOverrides = Object.create(null) as Record<string, CoreBlockRenderer>
  blockOverrides.image = (raw, _ctx, renderDefault) => {
    const block = raw as Block
    const directSrc = typeof block.src === 'string' ? block.src : ''
    const src = directSrc || (typeof block.url === 'string' ? block.url : '')
    if (!src.trim()) return ''
    const alt = typeof block.alt === 'string' ? block.alt : ''
    let image = directSrc ? renderDefault() : renderPortableDocument([{...block, src}])
    if (src.toLowerCase().startsWith('data:image/'))
      image = image.replace('src="#"', () => `src="${escapeHtml(src)}"`)
    return `<figure class="pd-image"><div class="pd-image-head"><span class="pd-image-name">${escapeHtml(imageFileName(src, alt, t('Image')))}</span><span class="pd-image-more" aria-hidden="true">${ELLIPSIS}</span></div>${image}</figure>`
  }
  for (const kind of objects) {
    const renderObject = (raw: PortableBlock) =>
      `<div class="pd-object" data-object-type="${escapeHtml(raw.type)}"><span class="pd-object-media" aria-hidden="true">${DOCUMENT_ICON}</span><span class="pd-object-title">${escapeHtml(objectBlockTitle(kind, raw, (value) => t(value ? 'Yes' : 'No')))}</span><span class="pd-image-more" aria-hidden="true">${ELLIPSIS}</span></div>`
    extensionBlocks[kind.name] = (raw) => renderObject(raw as PortableBlock)
    blockOverrides[kind.name] = (raw) => renderObject(raw)
  }

  const inlineObjects = Object.create(null) as Record<string, InlineObjectRenderer>
  for (const type of inlineObjectTypes(blocks))
    inlineObjects[type] = (node) =>
      `<span class="inline-object" data-type="${escapeHtml(type)}">${escapeHtml(node.text)}</span>`

  return externalLinks(renderPortableDocument(blocks, {
    blocks: extensionBlocks,
    blockOverrides,
    blockAttributes: (block) =>
      typeof block.id === 'string' ? {'data-bp-id': block.id} : undefined,
    inlineObjects,
    wikilink: (node, defaultHtml) => {
      const id = docId(node)
      const attrs = id
        ? ` data-doc-id="${escapeHtml(id)}"${linksOpen ? ' role="link" tabindex="0"' : ''}`
        : ''
      return defaultHtml
        .replace(/^<span/, () => `<span${attrs}`)
        .replace('class="bp-wikilink ', 'class="wikilink bp-wikilink ')
    },
  }))
}

/** `objects`: the body field's declared object kinds (`blocks.of`): those draw as the canvas's card. */
export function PortableDocView({blocks, linksOpen = false, objects = []}: {blocks: Block[]; linksOpen?: boolean; objects?: ObjectKind[]}) {
  const t = useT()
  const html = renderPortableDocView(blocks, linksOpen, objects, t)
  return <div className="portable-doc-view" dangerouslySetInnerHTML={{__html: html}} />
}
