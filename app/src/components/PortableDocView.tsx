import type {ReactNode} from 'react'
import {useT} from '../lib/i18n'
import {imageFileName} from '../lib/image'
import {DocumentIcon, Ellipsis} from './icons'
import {objectBlockTitle, type ObjectKind} from '../lib/object-block'

// A PortableDoc block list drawn read-only (J10): the body field before its canvas
// is activated, and anywhere a body is only shown. Covers what the post vocabulary
// can hold: headings, paragraphs, lists, quotes, callouts, images, and the inline
// marks and links inside them. An unknown block draws as its text. Blocks carry
// data-bp-id like the canvas's, so a caret maps from one to the other.

type Inline = {type: string; value?: string; text?: string; href?: string; docId?: string; target?: string; children?: Inline[]}
type Block = {id: string; type: string; level?: number; tone?: string; text?: string; content?: Inline[]; items?: Inline[][]; ordered?: boolean; src?: string; url?: string; alt?: string}

const MARKS: Record<string, string> = {strong: 'strong', em: 'em', code: 'code', underline: 'u', strikethrough: 's', highlight: 'mark', sub: 'sub', sup: 'sup'}

function inline(nodes: Inline[] = [], key = '', linksOpen = false): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`
    if (n.type === 'text' || n.value !== undefined) return n.value ?? ''
    // An inline object (J11, post-11's chip): its words, as a chip.
    if (!n.children && typeof n.text === 'string') return <span key={k} className="inline-object" data-type={n.type}>{n.text}</span>
    const kids = inline(n.children, `${k}.`, linksOpen)
    if (n.type === 'link' && n.href) return <a key={k} href={n.href} target="_blank" rel="noopener noreferrer">{kids}</a>
    // A link to a document (Sanity's internal link; portable-doc's wikilink): drawn as a
    // link, as the canvas draws it, so the body reads the same before it is clicked.
    // `linksOpen` (a read-only body): it is a link the reader follows, by click or Enter.
    if (n.type === 'wikilink')
      return (
        <span key={k} className="wikilink" data-wikilink="" data-doc-id={n.docId ?? undefined} {...(linksOpen && n.docId ? {role: 'link', tabIndex: 0} : {})}>
          {kids.length ? kids : n.target}
        </span>
      )
    const Tag = (MARKS[n.type] ?? 'span') as 'span'
    return <Tag key={k}>{kids}</Tag>
  })
}

/** `objects`: the body field's declared object kinds (`blocks.of`): those draw as the canvas's card. */
export function PortableDocView({blocks, linksOpen = false, objects = []}: {blocks: Block[]; linksOpen?: boolean; objects?: ObjectKind[]}) {
  const t = useT()
  return (
    <>
      {blocks.map((b) => {
        const body = b.content ? inline(b.content, '', linksOpen) : b.text
        // A declared object block (the callout) is Sanity's block object card, as the canvas
        // draws it (1.12.0): a tile with its icon, its preview title, a "…".
        const kind = objects.find((k) => k.name === b.type)
        if (kind)
          return (
            <div key={b.id} className="pd-object" data-bp-id={b.id} data-object-type={b.type}>
              <span className="pd-object-media" aria-hidden="true">
                <DocumentIcon />
              </span>
              <span className="pd-object-title">{objectBlockTitle(kind, b as unknown as Record<string, unknown>, (v) => t(v ? 'Yes' : 'No'))}</span>
              <span className="pd-image-more" aria-hidden="true">
                <Ellipsis />
              </span>
            </div>
          )
        switch (b.type) {
          case 'heading': {
            const H = `h${Math.min(6, Math.max(1, b.level ?? 2))}` as 'h2'
            return <H key={b.id} data-bp-id={b.id}>{body}</H>
          }
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul'
            return <L key={b.id} data-bp-id={b.id}>{(b.items ?? []).map((item, i) => <li key={i}>{inline(item, '', linksOpen)}</li>)}</L>
          }
          case 'pullquote':
          case 'blockquote':
            return <blockquote key={b.id} data-bp-id={b.id}>{body}</blockquote>
          case 'callout':
            return <div key={b.id} className="callout" data-tone={b.tone} data-bp-id={b.id}>{body}</div>
          case 'image': {
            // Barkpark's image block keeps its picture in `src` (the canvas writes it; an
            // older import may say `url`). Drawn as the canvas's card, as Sanity's at rest.
            const src = b.src ?? b.url
            if (!src) return null
            return (
              <figure key={b.id} className="pd-image" data-bp-id={b.id}>
                <div className="pd-image-head">
                  <span className="pd-image-name">{imageFileName(src, b.alt, t('Image'))}</span>
                  <span className="pd-image-more" aria-hidden="true">
                    <Ellipsis />
                  </span>
                </div>
                <img src={src} alt={b.alt ?? ''} />
              </figure>
            )
          }
          default:
            return <p key={b.id} data-bp-id={b.id}>{body}</p>
        }
      })}
    </>
  )
}
