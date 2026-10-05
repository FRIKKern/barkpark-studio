import type {ReactNode} from 'react'
import {useQuery} from '@tanstack/react-query'
import {docQuery, previewTitle, schemaOf, schemasQuery, type Doc, type Field, type Schema} from '../lib/data'
import {openAfter, type Pane} from '../lib/panes'
import {PaneLink} from './PaneLink'
import {RefPreview} from './Preview'

type Props = {panes: Pane[]; index: number; closeHref: string; header: ReactNode; closeIcon: ReactNode}

export function DocumentPane({panes, index, closeHref, header, closeIcon}: Props) {
  const pane = panes[index] as Extract<Pane, {kind: 'doc'}>
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: doc, isPending, error} = useQuery(docQuery(pane.type, pane.id))
  const schema = schemaOf(schemas, pane.type)
  const next = panes[index + 1]
  const openRef = (type: string, id: string, parentRefPath: string) => ({
    href: openAfter(panes, index, {kind: 'doc', id, type, parentRefPath}),
    selected: next?.kind === 'doc' && next.id === id && next.parentRefPath === parentRefPath,
    active: index === panes.length - 2,
  })

  return (
    <section className="pane doc" data-testid="document-pane" data-pane={`doc:${pane.id}`} data-pane-index={index}>
      <header className="pane-header">
        <span className="title" />
        <PaneLink href={closeHref} className="icon-btn" aria-label="Close pane" data-testid="pane-close">
          {closeIcon}
        </PaneLink>
      </header>
      <div className="doc-title-bar">{header}</div>
      <div className="pane-body">
        {error && <p role="alert">Could not load {pane.id}: {String(error)}</p>}
        {!isPending && !doc && !error && <p role="alert">Document {pane.id} not found.</p>}
        {doc && schema && (
          <div className="doc-form">
            <div className="kind">{schema.title}</div>
            <h1>{previewTitle(doc, schema)}</h1>
            {schema.fields.map((f) => (
              <FieldView key={f.name} field={f} path={f.name} value={doc[f.name]} openRef={openRef} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

type OpenRef = (type: string, id: string, parentRefPath: string) => {href: string; selected: boolean; active: boolean}

// Read-only for now: editing arrives with the Forms phase (J03). Inputs carry
// id=<field path>, like Sanity's, so the e2e rig drives both studios the same way.
function FieldView({field, path, value, openRef}: {field: Field; path: string; value: unknown; openRef: OpenRef}) {
  const label = field.title ?? field.name
  return (
    <div className="field">
      <label htmlFor={path}>{label}</label>
      <FieldInput field={field} path={path} value={value} openRef={openRef} />
    </div>
  )
}

function FieldInput({field, path, value, openRef}: {field: Field; path: string; value: unknown; openRef: OpenRef}) {
  switch (field.type) {
    case 'text':
      return <textarea id={path} className="input" rows={field.rows ?? 3} readOnly value={(value as string) ?? ''} />
    case 'boolean':
      return <input id={path} type="checkbox" readOnly checked={!!value} />
    case 'reference':
      return value ? (
        <div className="ref-box">
          <RefPreview type={field.refType!} id={value as string} {...openRef(field.refType!, value as string, path)} />
        </div>
      ) : (
        <div className="ref-box empty">Not set</div>
      )
    case 'arrayOf': {
      const items = (value as unknown[]) ?? []
      if (field.of?.type === 'reference')
        return (
          <div className="ref-box" id={path}>
            {items.map((id, i) => (
              <RefPreview key={i} type={field.of!.refType!} id={id as string} {...openRef(field.of!.refType!, id as string, `${path}[${i}]`)} />
            ))}
          </div>
        )
      return (
        <div className="tags" id={path}>
          {items.map((v, i) => (
            <span key={i} className="tag">
              {String(v)}
            </span>
          ))}
        </div>
      )
    }
    case 'composite':
      return (
        <div className="fieldset" id={path}>
          {field.fields?.map((f) => (
            <FieldView key={f.name} field={f} path={`${path}.${f.name}`} value={(value as Record<string, unknown>)?.[f.name]} openRef={openRef} />
          ))}
        </div>
      )
    case 'richText':
      return <RichText id={path} value={value} />
    case 'image':
      return <div className="image-empty">No image</div>
    default:
      return <input id={path} className="input" readOnly value={value == null ? '' : String(value)} />
  }
}

type Inline = {type: string; value?: string; children?: Inline[]}
type Block = {id: string; type: string; level?: number; tone?: string; content?: Inline[]}
const text = (nodes: Inline[] = []): string => nodes.map((n) => n.value ?? text(n.children)).join('')

function RichText({id, value}: {id: string; value: unknown}) {
  const blocks = ((value as {blocks?: Block[]})?.blocks ?? []) as Block[]
  return (
    <div className="input rich" id={id}>
      {blocks.map((b) =>
        b.type === 'heading' ? (
          <h2 key={b.id}>{text(b.content)}</h2>
        ) : b.type === 'callout' ? (
          <div key={b.id} className="callout">
            {text(b.content)}
          </div>
        ) : (
          <p key={b.id}>{text(b.content)}</p>
        ),
      )}
    </div>
  )
}

export type {Doc, Schema}
