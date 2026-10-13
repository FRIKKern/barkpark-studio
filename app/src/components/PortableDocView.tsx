import type {ReactNode} from 'react'

// A PortableDoc block list drawn read-only (J10): the body field before its canvas
// is activated, and anywhere a body is only shown. Covers what the post vocabulary
// can hold: headings, paragraphs, lists, quotes, callouts, images, and the inline
// marks and links inside them. An unknown block draws as its text. Blocks carry
// data-bp-id like the canvas's, so a caret maps from one to the other.

type Inline = {type: string; value?: string; text?: string; href?: string; docId?: string; target?: string; children?: Inline[]}
type Block = {id: string; type: string; level?: number; tone?: string; text?: string; content?: Inline[]; items?: Inline[][]; ordered?: boolean; url?: string; alt?: string}

const MARKS: Record<string, string> = {strong: 'strong', em: 'em', code: 'code', underline: 'u', strikethrough: 's', highlight: 'mark', sub: 'sub', sup: 'sup'}

function inline(nodes: Inline[] = [], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`
    if (n.type === 'text' || n.value !== undefined) return n.value ?? ''
    // An inline object (J11, post-11's chip): its words, as a chip.
    if (!n.children && typeof n.text === 'string') return <span key={k} className="inline-object" data-type={n.type}>{n.text}</span>
    const kids = inline(n.children, `${k}.`)
    if (n.type === 'link' && n.href) return <a key={k} href={n.href} target="_blank" rel="noopener noreferrer">{kids}</a>
    // A link to a document (Sanity's internal link; portable-doc's wikilink): drawn as a
    // link, as the canvas draws it, so the body reads the same before it is clicked.
    if (n.type === 'wikilink') return <span key={k} className="wikilink" data-wikilink="" data-doc-id={n.docId ?? undefined}>{kids.length ? kids : n.target}</span>
    const Tag = (MARKS[n.type] ?? 'span') as 'span'
    return <Tag key={k}>{kids}</Tag>
  })
}

export function PortableDocView({blocks}: {blocks: Block[]}) {
  return (
    <>
      {blocks.map((b) => {
        const body = b.content ? inline(b.content) : b.text
        switch (b.type) {
          case 'heading': {
            const H = `h${Math.min(6, Math.max(1, b.level ?? 2))}` as 'h2'
            return <H key={b.id} data-bp-id={b.id}>{body}</H>
          }
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul'
            return <L key={b.id} data-bp-id={b.id}>{(b.items ?? []).map((item, i) => <li key={i}>{inline(item)}</li>)}</L>
          }
          case 'pullquote':
          case 'blockquote':
            return <blockquote key={b.id} data-bp-id={b.id}>{body}</blockquote>
          case 'callout':
            return <div key={b.id} className="callout" data-tone={b.tone} data-bp-id={b.id}>{body}</div>
          case 'image':
            return b.url ? <img key={b.id} src={b.url} alt={b.alt ?? ''} /> : null
          default:
            return <p key={b.id} data-bp-id={b.id}>{body}</p>
        }
      })}
    </>
  )
}
