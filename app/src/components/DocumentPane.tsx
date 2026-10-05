import {useEffect, useState, type ReactNode} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {docQuery, previewTitle, schemaOf, schemasQuery, type Doc, type Field, type Schema} from '../lib/data'
import {edit, flush, publish, useSaveState} from '../lib/edits'
import {openAfter, type Pane} from '../lib/panes'
import {PaneLink} from './PaneLink'
import {RefPreview} from './Preview'
import {RefInput} from './RefInput'

type Props = {panes: Pane[]; index: number; closeHref: string; header: ReactNode; closeIcon: ReactNode}

export function DocumentPane({panes, index, closeHref, header, closeIcon}: Props) {
  const pane = panes[index] as Extract<Pane, {kind: 'doc'}>
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: doc, isPending, error} = useQuery(docQuery(pane.type, pane.id))
  const schema = schemaOf(schemas, pane.type)
  const next = panes[index + 1]
  const qc = useQueryClient()
  const onEdit = (field: string, value: unknown) => doc && edit(qc, doc, field, value)
  // Closing the pane (or navigating it away) sends what is still waiting.
  useEffect(() => () => flush(qc, pane.id), [qc, pane.id])
  const openRef = (type: string, id: string, parentRefPath: string) => ({
    href: openAfter(panes, index, {kind: 'doc', id, type, parentRefPath}),
    selected: next?.kind === 'doc' && next.id === id && next.parentRefPath === parentRefPath,
    active: index === panes.length - 2,
  })

  return (
    <section
      className="pane doc"
      data-testid="document-pane"
      data-pane={`doc:${pane.id}`}
      data-pane-index={index}
      onKeyDown={(e) => {
        // Sanity's publish shortcut.
        if (e.ctrlKey && e.altKey && e.code === 'KeyP' && doc) (e.preventDefault(), void publish(qc, doc))
      }}
    >
      <header className="pane-header">
        <span className="title chips">
          <span className="chip" data-off={doc?._hasPublished === false ? '' : undefined}>
            <span className="dot published" />
            Published
          </span>
          <span className="chip" data-active={doc?._draft ? '' : undefined}>
            <span className="dot draft" />
            Draft
          </span>
        </span>
        <PaneLink href={closeHref} className="icon-btn" aria-label="Close pane" data-testid="pane-close">
          {closeIcon}
        </PaneLink>
      </header>
      <div className="doc-title-bar">{header}</div>
      <div className="pane-body">
        {error && <p role="alert">Could not load {pane.id}: {String(error)}</p>}
        {!isPending && !doc && !error && <p role="alert">Document {pane.id} not found.</p>}
        {doc && schema && (
          <div className="doc-form" onBlur={() => flush(qc, pane.id)}>
            <div className="kind">{schema.title}</div>
            <h1>{docTitle(doc, schema)}</h1>
            {schema.fields.map((f) => (
              <FieldView key={f.name} field={f} path={f.name} value={doc[f.name]} openRef={openRef} onChange={(v) => onEdit(f.name, v)} />
            ))}
          </div>
        )}
      </div>
      {doc && <DocFooter doc={doc} />}
    </section>
  )
}

/** Sanity names an untitled doc "New <Type>" in its own pane, "Untitled" elsewhere. */
export const docTitle = (doc: Doc, schema: Schema) => {
  const t = previewTitle(doc, schema)
  return t === 'Untitled' ? `New ${schema.title}` : t
}

type OpenRef = (type: string, id: string, parentRefPath: string) => {href: string; selected: boolean; active: boolean}

// Read-only for now: editing arrives with the Forms phase (J03). Inputs carry
// id=<field path>, like Sanity's, so the e2e rig drives both studios the same way.
type FieldProps = {field: Field; path: string; value: unknown; openRef: OpenRef; onChange: (v: unknown) => void}

function FieldView(props: FieldProps) {
  const label = props.field.title ?? props.field.name
  return (
    <div className="field">
      <label htmlFor={props.path}>{label}</label>
      <FieldInput {...props} />
    </div>
  )
}

// Inputs carry id=<field path>, like Sanity's, so the e2e rig drives both studios
// the same way. Editable now: string, slug, text, number, datetime, boolean,
// object subfields, references (search + pick). Arrays and rich text: J09/J10.
function FieldInput({field, path, value, openRef, onChange}: FieldProps) {
  const str = value == null ? '' : String(value)
  switch (field.type) {
    case 'string':
    case 'slug':
      return <TextInput id={path} value={str} onChange={onChange} />
    case 'text':
      return <TextInput id={path} value={str} onChange={onChange} rows={field.rows ?? 3} />
    case 'number':
      return <NumberInput id={path} value={value as number | undefined} onChange={onChange} />
    case 'datetime':
      return <DateTimeInput id={path} value={value as string | undefined} onChange={onChange} />
    case 'boolean':
      return (
        <label className="switch">
          <input id={path} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span />
        </label>
      )
    case 'reference':
      return (
        <RefInput
          id={path}
          refType={field.refType!}
          value={value as string | undefined}
          onChange={onChange}
          linkFor={(id) => openRef(field.refType!, id, path)}
        />
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
            <FieldView
              key={f.name}
              field={f}
              path={`${path}.${f.name}`}
              value={(value as Record<string, unknown>)?.[f.name]}
              openRef={openRef}
              // Barkpark patches top-level fields only (task-bfb66a2ff491f6e7): send the whole object.
              onChange={(v) => onChange({...(value as Record<string, unknown>), [f.name]: v})}
            />
          ))}
        </div>
      )
    case 'richText':
      return <RichText id={path} value={value} />
    case 'image':
      return <div className="image-empty">No image</div>
    default:
      return <input id={path} className="input" readOnly value={str} />
  }
}

/**
 * The input owns its text between renders: React Query delivers cache updates a
 * tick later, and a controlled input re-rendered with that older value drops the
 * keystrokes typed in between. A new value from outside (remote edit) still wins.
 */
function TextInput({id, value, onChange, rows}: {id: string; value: string; onChange: (v: unknown) => void; rows?: number}) {
  const [local, setLocal] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setLocal(value)
  }
  const change = (v: string) => {
    setLocal(v)
    onChange(v)
  }
  return rows ? (
    <textarea id={id} className="input" rows={rows} value={local} onChange={(e) => change(e.target.value)} />
  ) : (
    <input id={id} className="input" value={local} onChange={(e) => change(e.target.value)} />
  )
}

/** Keeps what the user typed ("1.", "-") while the stored value stays a number. */
function NumberInput({id, value, onChange}: {id: string; value: number | undefined; onChange: (v: unknown) => void}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text !== null && Number(text) === value ? text : value == null ? '' : String(value)
  return (
    <input
      id={id}
      className="input"
      inputMode="decimal"
      value={shown}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value === '') onChange(undefined)
        else if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

// ISO in the store, local time in the input (Sanity shows local time too).
const toLocal = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
function DateTimeInput({id, value, onChange}: {id: string; value: string | undefined; onChange: (v: unknown) => void}) {
  return (
    <input
      id={id}
      className="input"
      type="datetime-local"
      value={toLocal(value)}
      onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)}
    />
  )
}

function DocFooter({doc}: {doc: Doc}) {
  const qc = useQueryClient()
  const {state, error} = useSaveState(doc._publishedId)
  const [publishing, setPublishing] = useState(false)
  const label = state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved — retrying' : doc._draft ? 'Saved' : 'Published'
  return (
    <footer className="doc-footer">
      <span className="save-state" data-state={state} title={error} role="status">
        {label}
      </span>
      <button
        className="publish"
        disabled={!doc._draft || state === 'error' || publishing}
        aria-keyshortcuts="Control+Alt+P"
        onClick={async () => {
          setPublishing(true)
          try {
            await publish(qc, doc)
          } finally {
            setPublishing(false)
          }
        }}
      >
        Publish
      </button>
    </footer>
  )
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
