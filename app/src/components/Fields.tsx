import {createContext, useContext, useState, type KeyboardEvent as ReactKeyboardEvent} from 'react'
import type {Doc, Field} from '../lib/data'
import {isHidden, isReadOnly} from '../lib/conditions'
import type {Problem} from '../lib/validation'
import {RefPreview} from './Preview'
import {RefInput} from './RefInput'
import {ChevronDown, ClearCircle, ErrorOutline} from './icons'
import {DateTimeInput} from './DateTimeInput'

// Field rendering for the document form: one component per Barkpark field type.
// Inputs carry id=<field path>, like Sanity's, so the e2e rig drives both studios the same way.

export type OpenRef = (type: string, id: string, parentRefPath: string) => {href: string; selected: boolean; active: boolean}

type FieldProps = {field: Field; path: string; value: unknown; openRef: OpenRef; onChange: (v: unknown) => void; readOnly?: boolean}

export const ProblemsContext = createContext<Problem[]>([])
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
  if (doc && isHidden(props.field, doc)) return null
  if (doc && isReadOnly(props.field, doc)) props = {...props, readOnly: true}
  const label = props.field.title ?? props.field.name
  const invalid = useContext(ProblemsContext).some((p) => p.path === props.path) || undefined
  // Sanity: a boolean is a switch with its label beside it, in a box.
  if (props.field.type === 'boolean')
    return (
      <div className="field">
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
        <legend>
          {label}
          <ProblemMark path={props.path} />
        </legend>
        <FieldInput {...props} />
      </fieldset>
    )
  return (
    <div className="field" data-invalid={invalid} data-readonly={props.readOnly || undefined}>
      <label htmlFor={props.path} id={`${props.path}-label`}>
        {label}
        <ProblemMark path={props.path} />
      </label>
      <FieldInput {...props} />
    </div>
  )
}

// Inputs carry id=<field path>, like Sanity's, so the e2e rig drives both studios
// the same way. Editable now: string, slug, text, number, datetime, boolean,
// object subfields, references (search + pick). Arrays and rich text: J09/J10.
function FieldInput({field, path, value, openRef, onChange, readOnly}: FieldProps) {
  const str = value == null ? '' : String(value)
  // Text stays focusable and selectable when read-only (Sanity does the same); other controls disable.
  if (readOnly && !['string', 'text', 'slug', 'composite', 'datetime'].includes(field.type))
    return (
      <fieldset className="readonly-wrap" disabled>
        <FieldInput field={field} path={path} value={value} openRef={openRef} onChange={onChange} />
      </fieldset>
    )
  switch (field.type) {
    case 'string':
      return <TextInput id={path} value={str} onChange={onChange} readOnly={readOnly} />
    case 'slug':
      return <SlugInput id={path} value={str} onChange={onChange} source={(field.options as {source?: string})?.source} readOnly={readOnly} />
    case 'text':
      return <TextInput id={path} value={str} onChange={onChange} rows={field.rows ?? 3} readOnly={readOnly} />
    case 'number':
      return <NumberInput id={path} value={value as number | undefined} onChange={onChange} />
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
              field={readOnly ? {...f, readOnly: true} : f}
              path={`${path}.${f.name}`}
              value={(value as Record<string, unknown>)?.[f.name]}
              openRef={openRef}
              // Barkpark patches top-level fields only (task-bfb66a2ff491f6e7), so a
              // subfield edit sends the whole object. Two editors on different
              // subfields at once: last write wins for the object (the J14 risk).
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
function TextInput({id, value, onChange, rows, readOnly}: {id: string; value: string; onChange: (v: unknown) => void; rows?: number; readOnly?: boolean}) {
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
    <textarea id={id} className="input" rows={rows} value={local} readOnly={readOnly} onChange={(e) => change(e.target.value)} />
  ) : (
    <input id={id} className="input" value={local} readOnly={readOnly} onChange={(e) => change(e.target.value)} onKeyDown={keepPaneStill} />
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

