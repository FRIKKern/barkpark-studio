import {createContext, useContext, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent} from 'react'
import {DialogBox, MenuPopover} from './FocusScopes'
import {refTypesOf, type Doc, type Field, type RefFilter} from '../lib/data'
import {isHidden, isReadOnly} from '../lib/conditions'
import {mapCaret} from '../lib/merge'
import type {Problem} from '../lib/validation'
import {RefInput} from './RefInput'
import {ChevronDown, ClearCircle, Ellipsis, ErrorOutline} from './icons'
import {copy, fits, read, signature} from '../lib/clipboard'
import {toast} from './Toasts'
import {FieldPresence} from './Presence'
import {DateTimeInput} from './DateTimeInput'
import {StringArrayInput, TagsInput} from './ArrayInputs'
import {ObjectArrayInput} from './ObjectArrayInput'
import {RefArrayInput} from './RefArrayInput'
import {CodeInput, ColorInput, LocalizedTextInput, ReadOnlyJson, SourceView} from './NativeInputs'

// Field rendering for the document form: one component per Barkpark field type.
// Inputs carry id=<field path>, like Sanity's, so the e2e rig drives both studios the same way.

export type OpenRef = (type: string, id: string, parentRefPath: string) => {href: string; selected: boolean; active: boolean}

type FieldProps = {field: Field; path: string; value: unknown; openRef: OpenRef; onChange: (v: unknown) => void; readOnly?: boolean}

export const ProblemsContext = createContext<Problem[]>([])
/** Writes one value at a dotted path ("seo.metaTitle"), so a subfield edit sends only that path. */
export const EditPathContext = createContext<((path: string, value: unknown) => void) | null>(null)
/** J15: top-level fields the draft changed since publish, and how to open Review changes. */
export const ChangesContext = createContext<{changed: Set<string>; review: () => void} | null>(null)
/** The doc being edited, for inputs that read a sibling field (slug's source). */
export const DocContext = createContext<Doc | null>(null)

/** The error mark beside a field label: Sanity shows the message on hover. */
function ProblemMark({path}: {path: string}) {
  const problem = useContext(ProblemsContext).find((p) => p.path === path)
  if (!problem) return null
  return (
    <span className="error-icon" role="img" aria-label={`Validation error: ${problem.message}`} title={problem.message}>
      <ErrorOutline />
    </span>
  )
}

/** One field: label, error mark, input. Hidden and read-only follow the doc as it is edited (J30). */
export function FieldView(props: FieldProps) {
  const doc = useContext(DocContext)
  const changes = useContext(ChangesContext)
  if (doc && isHidden(props.field, doc)) return null
  if (doc && isReadOnly(props.field, doc)) props = {...props, readOnly: true}
  const label = props.field.title ?? props.field.name
  const invalid = useContext(ProblemsContext).some((p) => p.path === props.path) || undefined
  // Sanity: a boolean is a switch with its label beside it, in a box.
  if (props.field.type === 'boolean')
    return (
      <div className="field">
        <FieldActions {...props} />
        {changes?.changed.has(props.path) && <ChangeBar onClick={changes.review} />}
        <label className="bool-box">
          <FieldInput {...props} />
          <span>{label}</span>
        </label>
      </div>
    )
  // An object: a fieldset with its title as the legend.
  if (props.field.type === 'composite')
    return (
      <fieldset className="field object-field">
        <FieldActions {...props} />
        {changes?.changed.has(props.path) && <ChangeBar onClick={changes.review} />}
        <legend>
          {label}
          <ProblemMark path={props.path} />
          <FieldPresenceHere path={props.path} />
        </legend>
        <FieldInput {...props} />
      </fieldset>
    )
  return (
    <div className="field" data-invalid={invalid} data-readonly={props.readOnly || undefined}>
      <FieldActions {...props} />
      {changes?.changed.has(props.path) && <ChangeBar onClick={changes.review} />}
      <label htmlFor={props.path} id={`${props.path}-label`}>
        {label}
        <ProblemMark path={props.path} />
        <FieldPresenceHere path={props.path} />
      </label>
      <FieldInput {...props} />
    </div>
  )
}

/** Sanity's change bar (J15): a thin line beside a field the draft changed; it opens Review changes. */
function ChangeBar({onClick}: {onClick: () => void}) {
  return <button type="button" className="change-bar" aria-label="Review changes" title="Review changes" onClick={onClick} />
}

/**
 * Sanity's field "…" menu (J29), shown on hover or focus at the top right of a
 * field: Copy field, Paste field. A paste whose schema type doesn't match is
 * refused with Sanity's toast. Absolutely placed, so it never moves the form.
 */
function FieldActions({field, value, onChange, readOnly}: FieldProps) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <div className="field-actions" data-open={open || undefined} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn" aria-label="Field actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <MenuPopover onClose={close} aria-label="Field actions">
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            autoFocus
            onClick={() => {
              copy({kind: 'field', field: {name: field.name, sig: signature(field), value}})
              close()
            }}
          >
            Copy field
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={readOnly}
            onClick={() => {
              close()
              const clip = read()
              const item = clip?.kind === 'field' ? clip.field : undefined
              if (!item) return toast({tone: 'critical', title: 'Nothing to paste', description: 'Copy a field first'})
              if (!fits(item.sig, item.value, field))
                return toast({tone: 'critical', title: 'Invalid clipboard item', description: 'Source and target schema types are not compatible'})
              onChange(item.value)
            }}
          >
            Paste field
          </button>
        </MenuPopover>
      )}
    </div>
  )
}

// Inputs carry id=<field path>, like Sanity's, so the e2e rig drives both studios
// the same way. Editable now: string, slug, text, number, datetime, boolean,
// object subfields, references (search + pick). Arrays and rich text: J09/J10.
function FieldInput({field, path, value, openRef, onChange, readOnly}: FieldProps) {
  const editPath = useContext(EditPathContext)
  const invalid = useContext(ProblemsContext).some((p) => p.path === path)
  const str = value == null ? '' : String(value)
  // Text stays focusable and selectable when read-only (Sanity does the same); other controls disable.
  if (readOnly && !['string', 'url', 'email', 'text', 'slug', 'composite', 'datetime', 'arrayOf', 'markdown', 'date', 'time', 'tags', 'color', 'source', 'json', 'localizedText', 'codelist'].includes(field.type))
    return (
      <fieldset className="readonly-wrap" disabled>
        <FieldInput field={field} path={path} value={value} openRef={openRef} onChange={onChange} />
      </fieldset>
    )
  switch (field.type) {
    case 'string':
    case 'url':
    case 'email':
      return <TextInput id={path} value={str} onChange={onChange} readOnly={readOnly} />
    case 'slug':
      return <SlugInput id={path} value={str} onChange={onChange} source={(field.options as {source?: string})?.source} readOnly={readOnly} />
    case 'text':
      return <TextInput id={path} value={str} onChange={onChange} rows={field.rows ?? 3} readOnly={readOnly} />
    case 'number':
    case 'float':
      return <NumberInput id={path} value={value as number | undefined} onChange={onChange} />
    case 'integer':
      return <NumberInput id={path} value={value as number | undefined} onChange={onChange} integer />
    // Barkpark-native types (B04), after the LiveView Studio.
    case 'markdown':
      return <TextInput id={path} value={str} onChange={onChange} rows={field.rows ?? 5} readOnly={readOnly} />
    case 'date':
      return <input id={path} className="input" type="date" value={str} readOnly={readOnly} onChange={(e) => onChange(e.target.value || undefined)} />
    case 'time':
      return <input id={path} className="input" type="time" value={str} readOnly={readOnly} onChange={(e) => onChange(e.target.value || undefined)} />
    case 'tags':
      return <TagsInput id={path} value={value} onChange={onChange} readOnly={readOnly} />
    case 'color':
      return <ColorInput id={path} value={value} onChange={onChange} readOnly={readOnly} />
    case 'source':
      return <SourceView id={path} value={value} />
    case 'json':
      return <ReadOnlyJson id={path} value={value} />
    case 'localizedText':
      return <LocalizedTextInput id={path} languages={field.languages ?? []} value={value} onChange={onChange} readOnly={readOnly} />
    case 'codelist':
      return <CodeInput id={path} codelistId={field.codelistId} value={value} onChange={onChange} readOnly={readOnly} />
    case 'datetime':
      return <DateTimeInput id={path} value={value as string | undefined} onChange={onChange} readOnly={readOnly} />
    case 'select':
      return <SelectInput id={path} field={field} value={value} onChange={onChange} />
    case 'boolean':
      return (
        <span className="switch">
          <input id={path} type="checkbox" role="switch" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span />
        </span>
      )
    case 'reference':
      return (
        <RefInput
          id={path}
          types={refTypesOf(field)}
          filter={field.options?.filter as RefFilter | undefined}
          value={value as string | undefined}
          invalid={invalid}
          onChange={onChange}
          linkFor={(id, type) => openRef(type, id, path)}
        />
      )
    case 'arrayOf': {
      const items = (value as unknown[]) ?? []
      if (field.of?.type === 'reference') return <RefArrayInput id={path} field={field} value={value} onChange={onChange} readOnly={readOnly} openRef={openRef} />
      if (field.of?.type === 'string' || field.of?.type === 'text')
        return (field.options as {layout?: string} | undefined)?.layout === 'tags' ? (
          <TagsInput id={path} value={value} onChange={onChange} readOnly={readOnly} />
        ) : (
          <StringArrayInput id={path} value={value} onChange={onChange} readOnly={readOnly} />
        )
      if (field.of?.type === 'composite') return <ObjectArrayInput id={path} field={field} value={value} onChange={onChange} readOnly={readOnly} openRef={openRef} />
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
              field={readOnly ? {...f, readOnly: true} : f}
              path={`${path}.${f.name}`}
              value={(value as Record<string, unknown>)?.[f.name]}
              openRef={openRef}
              // Barkpark patches paths (task-bfb66a2ff491f6e7): a subfield edit sends
              // only its own path, so two editors on different subfields both keep theirs.
              onChange={(v) => (editPath ? editPath(`${path}.${f.name}`, v) : onChange({...(value as Record<string, unknown>), [f.name]: v}))}
            />
          ))}
        </div>
      )
    case 'richText':
      return <RichText id={path} value={value} />
    case 'image':
      return <div className="image-empty">No image</div>
    default:
      // A type this Studio has no editor for: never "[object Object]".
      return value !== null && typeof value === 'object' ? <ReadOnlyJson id={path} value={value} note="read-only — no editor for this field type yet" /> : <input id={path} className="input" readOnly value={str} />
  }
}

/**
 * The input owns its text between renders: React Query delivers cache updates a
 * tick later, and a controlled input re-rendered with that older value drops the
 * keystrokes typed in between. A new value from outside (remote edit) still wins.
 */
function TextInput({id, value, onChange, rows, readOnly}: {id: string; value: string; onChange: (v: unknown) => void; rows?: number; readOnly?: boolean}) {
  const [local, setLocal] = useState(value)
  const [seen, setSeen] = useState(value)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const caret = useRef<number | null>(null)
  if (value !== seen) {
    // Someone else's edit (J06): keep the caret on the same text, not at the end (F6).
    const el = ref.current
    if (el && el === document.activeElement && el.value !== value) caret.current = mapCaret(el.value, value, el.selectionStart ?? 0)
    setSeen(value)
    setLocal(value)
  }
  useLayoutEffect(() => {
    if (caret.current === null) return
    ref.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })
  const change = (v: string) => {
    setLocal(v)
    onChange(v)
  }
  return rows ? (
    <textarea ref={ref} id={id} className="input" rows={rows} value={local} readOnly={readOnly} onChange={(e) => change(e.target.value)} />
  ) : (
    <input ref={ref} id={id} className="input" value={local} readOnly={readOnly} onChange={(e) => change(e.target.value)} onKeyDown={keepPaneStill} />
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

// Sanity's slugify: lowercase, accents dropped, runs of anything else become '-'.
const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200)

/** A slug: a text input plus Sanity's Generate, from the field named in options.source. */
function SlugInput({id, value, onChange, source, readOnly}: {id: string; value: string; onChange: (v: unknown) => void; source?: string; readOnly?: boolean}) {
  const doc = useContext(DocContext)
  const from = source && doc ? doc[source] : undefined
  const [, force] = useState(0)
  return (
    <div className="slug-row">
      <TextInput id={id} value={value} onChange={onChange} readOnly={readOnly} />
      {source && (
        <button
          type="button"
          className="btn-create"
          disabled={readOnly || typeof from !== 'string' || !from}
          onClick={() => (onChange(slugify(String(from))), force((n) => n + 1))}
        >
          Generate
        </button>
      )}
    </div>
  )
}

// Barkpark select options: plain values, or {value, title} (legacy {value, label}).
type Option = {value: unknown; title: string}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function optionsOf(field: Field): Option[] {
  const raw = (Array.isArray(field.options) ? field.options : (field.options as {list?: unknown[]})?.list) ?? []
  return raw.map((o) =>
    o && typeof o === 'object'
      ? {value: (o as {value: unknown}).value, title: String((o as {title?: string; label?: string}).title ?? (o as {label?: string}).label ?? (o as {value: unknown}).value)}
      : {value: o, title: capitalize(String(o))},
  )
}

/**
 * Sanity's string list (J31): `layout: "radio"` is a row of radios in a box with a
 * clear button; otherwise a dropdown whose blank first option means "no value".
 */
function SelectInput({id, field, value, onChange}: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void}) {
  const options = optionsOf(field)
  if (field.layout === 'radio')
    return (
      <div className="radio-box">
        <div role="group" aria-labelledby={`${id}-label`} id={id}>
          {options.map((o) => (
            <label key={String(o.value)} className="radio">
              <input type="radio" name={id} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span>{o.title}</span>
            </label>
          ))}
        </div>
        {value !== undefined && (
          <button type="button" className="icon-btn" aria-label="Clear" title="Clear" onClick={() => onChange(undefined)}>
            <ClearCircle />
          </button>
        )}
      </div>
    )
  const index = options.findIndex((o) => o.value === value)
  return (
    <span className="select-box">
      <select id={id} className="input" value={index} onChange={(e) => onChange(Number(e.target.value) < 0 ? undefined : options[Number(e.target.value)]!.value)}>
        <option value={-1} />
        {options.map((o, i) => (
          <option key={i} value={i}>
            {o.title}
          </option>
        ))}
      </select>
      <ChevronDown />
    </span>
  )
}

/** Keeps what the user typed ("1.", "-") while the stored value stays a number. */
function NumberInput({id, value, onChange, integer}: {id: string; value: number | undefined; onChange: (v: unknown) => void; integer?: boolean}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text !== null && Number(text) === value ? text : value == null ? '' : String(value)
  return (
    <input
      id={id}
      className="input"
      // The phone's number pad: digits only for integers.
      inputMode={integer ? 'numeric' : 'decimal'}
      value={shown}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value === '') onChange(undefined)
        else if (Number.isFinite(n) && (!integer || Number.isInteger(n))) onChange(n)
      }}
    />
  )
}

type Inline = {type: string; value?: string; children?: Inline[]}
type Block = {id: string; type: string; level?: number; tone?: string; content?: Inline[]}
const text = (nodes: Inline[] = []): string => nodes.map((n) => n.value ?? text(n.children)).join('')

export function RichText({id, value}: {id: string; value: unknown}) {
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


/** J07: who else has their caret in this field. */
function FieldPresenceHere({path}: {path: string}) {
  const doc = useContext(DocContext)
  return doc ? <FieldPresence docId={doc._publishedId} path={path} /> : null
}
