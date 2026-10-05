import {useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {usePublishedPerspective} from '../lib/perspective'
import {docQuery, previewTitle, publishedQuery, schemaOf, schemasQuery, type Doc, type Field, type Schema} from '../lib/data'
import {discardDraft, edit, flush, publish, unpublish, useSaveState} from '../lib/edits'
import {openAfter, panesPath, type Pane} from '../lib/panes'
import {PaneLink} from './PaneLink'
import {RefPreview} from './Preview'
import {RefInput} from './RefInput'
import {DeleteDialog} from './DeleteDialog'
import {Ellipsis} from './icons'

type Props = {panes: Pane[]; index: number; closeHref: string; header: ReactNode; closeIcon: ReactNode}

export function DocumentPane({panes, index, closeHref, header, closeIcon}: Props) {
  const pane = panes[index] as Extract<Pane, {kind: 'doc'}>
  const {data: schemas = []} = useQuery(schemasQuery)
  // Sanity's two perspectives, in the URL: the draft you edit (default), or the
  // published version, read-only (?perspective=published).
  const viewingPublished = usePublishedPerspective()
  const draftQ = useQuery(docQuery(pane.type, pane.id))
  const publishedQ = useQuery({...publishedQuery(pane.type, pane.id), enabled: viewingPublished})
  const {data: doc, isPending, error} = viewingPublished ? publishedQ : draftQ
  const base = panesPath(panes)
  const navigate = useNavigate()
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
          {draftQ.data?._hasPublished === false ? (
            <span className="chip" data-off="" aria-disabled="true" title="Not published">
              <span className="dot published" />
              Published
            </span>
          ) : (
            <button type="button" className="chip" data-selected={viewingPublished ? '' : undefined} aria-pressed={viewingPublished} onClick={() => navigate({href: `${base}?perspective=published`})}>
              <span className="dot published" />
              Published
            </button>
          )}
          <button
            type="button"
            className="chip"
            data-active={!viewingPublished && draftQ.data?._draft ? '' : undefined}
            data-selected={!viewingPublished ? '' : undefined}
            aria-pressed={!viewingPublished}
            onClick={() => navigate({href: base})}
          >
            <span className="dot draft" />
            Draft
          </button>
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
            {/* The published version is read-only: a disabled fieldset disables every control in it. */}
            <fieldset className="form-fields" disabled={viewingPublished}>
              {schema.fields.map((f) => (
                <FieldView key={f.name} field={f} path={f.name} value={doc[f.name]} openRef={openRef} onChange={(v) => onEdit(f.name, v)} />
              ))}
            </fieldset>
          </div>
        )}
      </div>
      {viewingPublished
        ? doc && <PublishedFooter doc={doc} />
        : doc && <DocFooter doc={doc} closeHref={closeHref} />}
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
    <input id={id} className="input" value={local} onChange={(e) => change(e.target.value)} onKeyDown={keepPaneStill} />
  )
}

/**
 * Home/End with the caret already at that end do nothing in the input, so the
 * browser scrolls the pane instead (a jump Sanity doesn't make). Swallow those.
 */
function keepPaneStill(e: ReactKeyboardEvent<HTMLInputElement>) {
  const el = e.currentTarget
  const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
  const atStart = el.selectionStart === 0 && el.selectionEnd === 0
  if ((e.key === 'End' && atEnd) || (e.key === 'Home' && atStart)) e.preventDefault()
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

function DocFooter({doc, closeHref}: {doc: Doc; closeHref: string}) {
  const qc = useQueryClient()
  const {state, error} = useSaveState(doc._publishedId)
  const [publishing, setPublishing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  // Discard needs a draft to drop and a published version to fall back to.
  const canDiscard = !!doc._draft && doc._hasPublished !== false
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
      <div className="menu-wrap">
        <button type="button" className="icon-btn" aria-label="Document actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <Ellipsis />
        </button>
        {menu && (
          <div className="popover menu up" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
            <button type="button" role="menuitem" className="menu-item" autoFocus disabled={!canDiscard} onClick={() => (setMenu(false), setDiscarding(true))}>
              Discard changes
            </button>
            <button type="button" role="menuitem" className="menu-item danger" onClick={() => (setMenu(false), setDeleting(true))}>
              Delete
            </button>
          </div>
        )}
      </div>
      {deleting && <DeleteDialog doc={doc} closeHref={closeHref} onClose={() => setDeleting(false)} />}
      {discarding && (
        <ConfirmDialog
          title="Discard changes?"
          body="Are you sure you want to discard all changes since last published?"
          action="Discard changes"
          run={() => discardDraft(qc, doc)}
          onClose={() => setDiscarding(false)}
        />
      )}
    </footer>
  )
}

/** The Published perspective: read-only, and the way to take a document down. */
function PublishedFooter({doc}: {doc: Doc}) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  return (
    <footer className="doc-footer">
      <span className="save-state" role="status">
        Published
      </span>
      <button className="publish danger" onClick={() => setConfirm(true)}>
        Unpublish
      </button>
      {confirm && (
        <ConfirmDialog
          title="Unpublish document?"
          body="It will no longer be live. Its content stays as a draft you can publish again."
          action="Unpublish now"
          run={() => unpublish(qc, doc)}
          onClose={() => setConfirm(false)}
        />
      )}
    </footer>
  )
}

/** A Sanity-style confirm over the pane: Cancel (focused) or the red action. Failures show inline. */
function ConfirmDialog({title, body, action, run, onClose}: {title: string; body: string; action: string; run: () => Promise<unknown>; onClose: () => void}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header>
          <h2>{title}</h2>
        </header>
        <div className="dialog-body">
          <p>{body}</p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="btn" autoFocus onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(undefined)
              try {
                await run()
                onClose()
              } catch (err) {
                setError((err as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {action}
          </button>
        </footer>
      </div>
    </div>
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
