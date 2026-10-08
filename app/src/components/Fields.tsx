import {createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type KeyboardEvent as ReactKeyboardEvent, type RefObject} from 'react'
import {MenuPopover} from './FocusScopes'
import {refTypesOf, type Doc, type Field, type RefFilter} from '../lib/data'
import {isHidden, isReadOnly} from '../lib/conditions'
import {mapCaret} from '../lib/merge'
import {worst, type Level, type Problem} from '../lib/validation'
import {RefInput} from './RefInput'
import {ChevronDown, ClearCircle, ClipboardIcon, Copy, Ellipsis, ErrorOutline, Collapse, Expand, InfoOutline, ToggleArrowRight, WarningOutline} from './icons'
import {copy, fits, read, signature} from '../lib/clipboard'
import {toast} from './Toasts'
import {BlockPresence, FieldPresence} from './Presence'
import {DateTimeInput} from './DateTimeInput'
import {StringArrayInput, TagsInput} from './ArrayInputs'
import {ObjectArrayInput} from './ObjectArrayInput'
import {RefArrayInput} from './RefArrayInput'
import {ColorInput, LocalizedTextInput, ReadOnlyJson, SourceView} from './NativeInputs'
import {CodelistInput} from './CodelistInput'
import {FileInput} from './FileInput'
import {ImageInput} from './ImageInput'
import {FieldComments} from './Comments'
import {InvalidValueCard, KeysAlert, RichTextCard} from './BrokenValues'
import {invalidValue, keyProblem, richTextProblem} from '../lib/broken'
import {PortableDocEditor} from './PortableDocEditor'
import {PortableDocView} from './PortableDocView'
import {modKey, useTip} from './Tip'

// Field rendering for the document form: one component per Barkpark field type.
// Inputs carry id=<field path>, like Sanity's, so the e2e rig drives both studios the same way.

export type OpenRef = (type: string, id: string, parentRefPath: string) => {href: string; selected: boolean; active: boolean}

type FieldProps = {field: Field; path: string; value: unknown; openRef: OpenRef; onChange: (v: unknown) => void; readOnly?: boolean}

export const ProblemsContext = createContext<Problem[]>([])
/**
 * J13/J14: which collapsible objects are open (Sanity's `options.collapsible` /
 * `collapsed`). The pane owns it, so a validation click can open the way to a field.
 */
export const OpenObjectsContext = createContext<{isOpen: (path: string, byDefault: boolean) => boolean; toggle: (path: string, open: boolean) => void} | null>(null)
/** Writes one value at a dotted path ("seo.metaTitle"), so a subfield edit sends only that path. */
export const EditPathContext = createContext<((path: string, value: unknown) => void) | null>(null)
/** J15: top-level fields the draft changed since publish, and how to open Review changes. */
export const ChangesContext = createContext<{changed: Set<string>; review: () => void} | null>(null)
/** The doc being edited, for inputs that read a sibling field (slug's source,
 *  conditional fields). It changes on every keystroke, so only those read it. */
export const DocContext = createContext<Doc | null>(null)
/** The doc's id: steady while typing, for what only needs to know which doc. */
export const DocIdContext = createContext<string | null>(null)
/** The doc's type, steady too (a richText field's canvas saves to its own doc). */
export const DocTypeContext = createContext<string | null>(null)
/** J52: the field path the URL asks for (`path=`), so an array can open the item it sits in. */
export const UrlPathContext = createContext<string | undefined>(undefined)

const LEVEL_ICON: Record<Level, () => ReactElement> = {error: ErrorOutline, warning: WarningOutline, info: InfoOutline}
const LEVEL_WORD: Record<Level, string> = {error: 'Validation error', warning: 'Validation warning', info: 'Validation info'}

/** Sanity's mark for an error, warning or info: one icon per level, the message on hover. */
export function LevelIcon({level, label}: {level: Level; label?: string}) {
  const Icon = LEVEL_ICON[level]
  return (
    <span className="error-icon" data-level={level} role="img" aria-label={label ?? LEVEL_WORD[level]} title={label}>
      <Icon />
    </span>
  )
}

/** The mark beside a field label; `within`: also what a collapsed object hides. */
export function ProblemMark({path, within}: {path: string; within?: boolean}) {
  const all = useContext(ProblemsContext).filter((p) => p.path === path || (within && p.path.startsWith(`${path}.`)))
  const level = worst(all)
  if (!level) return null
  const problem = all.find((p) => p.level === level)!
  return <LevelIcon level={level} label={`${LEVEL_WORD[level]}: ${problem.message}`} />
}

/**
 * One field: label, error mark, input. Memoized (J44): a keystroke re-renders the
 * field it changed, not all 200 of a long doc. So the props must stay steady while
 * typing (DocumentPane keeps onChange and openRef stable), and only a field with a
 * condition reads the whole doc. Hidden and read-only follow the doc as it is edited (J30).
 */
export const FieldView = memo(function FieldView(props: FieldProps) {
  const conditional = !!props.field.visibleWhen || (typeof props.field.readOnly === 'object' && props.field.readOnly !== null)
  return conditional ? <ConditionalField {...props} /> : <FieldBody {...props} />
})

function ConditionalField(props: FieldProps) {
  const doc = useContext(DocContext)
  if (doc && isHidden(props.field, doc)) return null
  return <FieldBody {...props} readOnly={props.readOnly || (doc ? isReadOnly(props.field, doc) : false)} />
}

/** An object (or an image): a fieldset, its title the legend. Collapsible ones fold, like Sanity's. */
function ObjectField(props: FieldProps & {label: string; changed: boolean; review?: () => void}) {
  const {label, changed, review, ...field} = props
  const options = (Array.isArray(field.field.options) ? {} : field.field.options ?? {}) as {collapsible?: boolean; collapsed?: boolean}
  const opened = useContext(OpenObjectsContext)
  const collapsible = !!options.collapsible || !!options.collapsed
  const open = !collapsible || (opened ? opened.isOpen(field.path, !options.collapsed) : !options.collapsed)
  return (
    <fieldset className="field object-field" data-collapsible={collapsible || undefined} data-open={collapsible ? open : undefined}>
      <FieldActions {...field} />
      <FieldComments path={field.path} title={label} />
      {changed && review && <ChangeBar onClick={review} />}
      <legend>
        {collapsible ? (
          <button type="button" className="object-toggle" aria-expanded={open} onClick={() => opened?.toggle(field.path, !open)}>
            <span className="toggle-arrow" data-open={open}>
              <ToggleArrowRight />
            </span>
            {label}
          </button>
        ) : (
          label
        )}
        <ProblemMark path={field.path} within={!open} />
        <FieldPresenceHere path={field.path} />
      </legend>
      {open && <FieldInput {...field} />}
    </fieldset>
  )
}

function FieldBody(props: FieldProps) {
  if (props.field.readOnly === true) props = {...props, readOnly: true}
  const changes = useContext(ChangesContext)
  const label = props.field.title ?? props.field.name
  const invalid = useContext(ProblemsContext).some((p) => p.path === props.path && p.level === 'error') || undefined
  // Sanity: a boolean is a switch with its label beside it, in a box.
  if (props.field.type === 'boolean' && !invalidValue(props.field, props.value))
    return (
      <div className="field">
        <FieldActions {...props} />
        <FieldComments path={props.path} title={label} />
        {changes?.changed.has(props.path) && <ChangeBar onClick={changes.review} />}
        <label className="bool-box">
          <FieldInput {...props} />
          <span>{label}</span>
        </label>
      </div>
    )
  // An object (or an image, with its own fields below it): a fieldset with its title as the legend.
  if (props.field.type === 'composite' || props.field.type === 'image')
    return (
      <ObjectField {...props} label={label} changed={!!changes?.changed.has(props.path)} review={changes?.review} />
    )
  return (
    <div className="field" data-invalid={invalid} data-readonly={props.readOnly || undefined}>
      <FieldActions {...props} />
        <FieldComments path={props.path} title={label} />
      {changes?.changed.has(props.path) && <ChangeBar onClick={changes.review} />}
      <label htmlFor={props.path} id={`${props.path}-label`} onClick={(e) => {
        // Split panes repeat field paths. Native label lookup finds the first copy.
        if ((e.target as Element).closest('button, a, [role="button"]')) return
        const control = e.currentTarget.parentElement?.querySelector<HTMLElement>(`[id="${CSS.escape(props.path)}"]`)
        if (control?.matches('input, textarea, select, button') && e.currentTarget.control !== control) {
          e.preventDefault()
          control.focus()
        }
      }}>
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
/**
 * J29: Cmd/Ctrl+C and V on a focused field that isn't text (an object, an image, a
 * switch, an array row) copy and paste it, as Sanity's form does. Each field (and
 * array row) registers its copy/paste on its element; the pane's keydown finds the
 * nearest one (see DocumentPane).
 */
export const fieldClipboard = new WeakMap<Element, {copy: () => void; paste?: () => void}>()

function FieldActions({field, value, onChange, readOnly}: FieldProps) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const doCopy = () => copy({kind: 'field', field: {name: field.name, sig: signature(field), value}})
  const doPaste = () => {
    const clip = read()
    const item = clip?.kind === 'field' ? clip.field : undefined
    if (!item) return toast({tone: 'critical', title: 'Nothing to paste', description: 'Copy a field first'})
    if (!fits(item.sig, item.value, field))
      return toast({tone: 'critical', title: 'Invalid clipboard item', description: 'Source and target schema types are not compatible'})
    onChange(item.value)
  }
  const latest = useRef({doCopy, doPaste, readOnly})
  latest.current = {doCopy, doPaste, readOnly}
  const register = (el: HTMLDivElement | null) => {
    const host = el?.parentElement
    if (host) fieldClipboard.set(host, {copy: () => latest.current.doCopy(), paste: () => !latest.current.readOnly && latest.current.doPaste()})
  }
  return (
    <div ref={register} className="field-actions" data-open={open || undefined} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
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
              doCopy()
              close()
            }}
          >
            <span className="menu-icon-text">
              <Copy /> Copy field
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={readOnly}
            onClick={() => {
              close()
              doPaste()
            }}
          >
            <span className="menu-icon-text">
              <ClipboardIcon /> Paste field
            </span>
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
  const invalid = useContext(ProblemsContext).some((p) => p.path === path && p.level === 'error')
  // J39: a stored value this input can't edit gets Sanity's fix-it card instead.
  const wrongType = invalidValue(field, value)
  if (wrongType) return <InvalidValueCard invalid={wrongType} value={value} onChange={onChange} />
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
      return <LocalizedTextInput id={path} languages={field.languages ?? []} fallbackChain={field.fallbackChain} value={value} onChange={onChange} readOnly={readOnly} />
    case 'codelist':
      return <CodelistInput id={path} codelistId={field.codelistId} value={value} onChange={onChange} readOnly={readOnly} />
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
      const keys = keyProblem(items)
      if (keys) return <KeysAlert problem={keys} onChange={onChange} />
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
    case 'richText': {
      const broken = richTextProblem(value)
      if (broken) return <RichTextCard problem={broken} onChange={onChange} />
      // J10: a block-editor field is Barkpark's canvas (decision 0004), scoped to the field.
      return field.editor === 'blocks' && !path.includes('.') ? <BodyCanvas field={path} value={value} vocabulary={(field as {blocks?: unknown}).blocks} readOnly={readOnly} /> : <RichText id={path} value={value} />
    }
    case 'image':
      return <ImageInput id={path} field={field} value={value} onChange={onChange} readOnly={readOnly} openRef={openRef} />
    case 'file':
      return <FileInput id={path} field={field} value={value} onChange={onChange} readOnly={readOnly} openRef={openRef} />
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
export function TextInput({id, value, onChange, rows, readOnly}: {id: string; value: string; onChange: (v: unknown) => void; rows?: number; readOnly?: boolean}) {
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
          // Sanity's stays enabled with an empty source; the click then does nothing.
          disabled={readOnly}
          onClick={() => typeof from === 'string' && from && (onChange(slugify(from)), force((n) => n + 1))}
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


/**
 * J10: the body is drawn read-only until it is activated — a click, or Enter/typing
 * on it — then Barkpark's canvas mounts in its place with the caret at the end, as
 * Sanity's portable-text input asks for one click to activate. Until then a doc
 * with a body costs nothing extra (no canvas bundle, no block reads), and a remote
 * edit to the body just redraws.
 */
function BodyCanvas({field, value, vocabulary, readOnly}: {field: string; value: unknown; vocabulary?: unknown; readOnly?: boolean}) {
  const id = useContext(DocIdContext)
  const type = useContext(DocTypeContext)
  const [active, setActive] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const area = useExpandArea(box, expanded)
  // Where the activating click landed, as (block id, text offset): the caret goes
  // there once the canvas is up (one click activates and places it). By keyboard:
  // the end of the text. Mapped by block, not by pixel: the canvas lays out a
  // little differently from the read-only view.
  const at = useRef<{block: string; offset: number} | null>(null)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => {
      const pm = box.current?.querySelector<HTMLElement>('.ProseMirror')
      if (!pm) return
      clearInterval(t)
      if (pm.contains(document.activeElement)) return // the author got there first
      pm.focus()
      const sel = getSelection()
      if (!sel) return
      const target = at.current && caretIn(pm.querySelector<HTMLElement>(`[data-bp-id="${CSS.escape(at.current.block)}"]`), at.current.offset)
      if (target) sel.collapse(target.node, target.offset)
      else (sel.selectAllChildren(pm), sel.collapseToEnd())
    }, 30)
    return () => clearInterval(t)
  }, [active])
  if (!id || !type) return null
  const blocks = ((value as {blocks?: unknown[]} | undefined)?.blocks ?? []) as Parameters<typeof PortableDocView>[0]['blocks']
  if (!active)
    return (
      <div
        className="body-canvas body-static"
        id={field}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={`${field}-label`}
        aria-readonly={readOnly || undefined}
        tabIndex={0}
        onClick={(e) => !readOnly && !(e.target as HTMLElement).closest('a') && ((at.current = clickedAt(e.clientX, e.clientY)), setActive(true))}
        // Keys on the box itself; Enter or Space on the expand button is that button's own click.
        onKeyDown={(e) => {
          if (readOnly || e.target !== e.currentTarget) return
          // J35: Cmd/Ctrl+Enter opens it expanded, as Sanity's hotkey.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return e.preventDefault(), setActive(true), setExpanded(true)
          if ((e.key === 'Enter' || e.key.length === 1) && !e.metaKey && !e.ctrlKey) e.preventDefault(), setActive(true)
        }}
      >
        {!readOnly && (
          <ExpandButton expanded={false} onClick={(e) => (e.stopPropagation(), setActive(true), setExpanded(true))} />
        )}
        <div className="bp-paper-editor-body">{blocks.length ? <PortableDocView blocks={blocks} /> : <p className="muted">Empty</p>}</div>
        {id && <BlockPresence docId={id} field={field} />}
      </div>
    )
  // J35: expand over the document pane and back. The same canvas stays mounted (only
  // its frame moves), the button never takes focus, and the caret is scrolled back
  // into view after: caret, selection and edits are kept.
  const toggle = () => {
    setExpanded((x) => !x)
    requestAnimationFrame(() => getSelection()?.focusNode?.parentElement?.scrollIntoView({block: 'nearest'}))
  }
  return (
    <div
      className="body-canvas"
      id={field}
      ref={box}
      data-expanded={expanded || undefined}
      style={expanded ? area : undefined}
      // Escape collapses. Caught before the canvas, whose own keymap takes Escape to
      // select the parent block; an open canvas menu or the link input keeps it.
      onKeyDownCapture={(e) =>
        // J35: Cmd/Ctrl+Enter toggles (before the canvas, whose keymap takes it for a line break).
        e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey
          ? (e.preventDefault(), e.stopPropagation(), toggle())
          : expanded &&
        e.key === 'Escape' &&
        (e.target as HTMLElement).closest('.ProseMirror') &&
        ![...document.querySelectorAll('[role="listbox"], [role="menu"]')].some((m) => m.checkVisibility()) &&
        (e.preventDefault(), e.stopPropagation(), toggle())
      }
    >
      <ExpandButton expanded={expanded} aria-pressed={expanded} onMouseDown={(e) => e.preventDefault()} onClick={toggle} />
      <PortableDocEditor type={type} id={id} field={field} vocabulary={vocabulary} labelledBy={`${field}-label`} editable={!readOnly} />
      {id && <BlockPresence docId={id} field={field} />}
    </div>
  )
}

/** The body's expand button; its tooltip names the hotkey (J35, Sanity's "Expand editor ⌘ Enter"). */
function ExpandButton({expanded, ...rest}: {expanded: boolean} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const label = expanded ? 'Collapse editor' : 'Expand editor'
  const {anchor, tip} = useTip(() => (
    <span className="tip-line">
      {label}
      <span>
        <kbd>{modKey()}</kbd> <kbd>Enter</kbd>
      </span>
    </span>
  ))
  return (
    <button type="button" className="icon-btn body-expand" aria-label={label} aria-keyshortcuts="Control+Enter Meta+Enter" {...rest} {...anchor}>
      {expanded ? <Collapse /> : <Expand />}
      {tip}
    </button>
  )
}

/** The block (data-bp-id) and text offset under a point in the read-only body. */
function clickedAt(x: number, y: number) {
  const range = document.caretRangeFromPoint(x, y)
  const block = range?.startContainer.parentElement?.closest<HTMLElement>('[data-bp-id]')
  if (!range || !block) return null
  const before = document.createRange()
  before.setStart(block, 0)
  before.setEnd(range.startContainer, range.startOffset)
  return {block: block.dataset.bpId!, offset: before.toString().length}
}

/** The text node and offset `offset` characters into `el`. */
function caretIn(el: HTMLElement | null, offset: number): {node: Node; offset: number} | null {
  if (!el) return null
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let left = offset
  let last: Text | null = null
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    if (left <= n.length) return {node: n, offset: left}
    left -= n.length
    last = n
  }
  return last ? {node: last, offset: last.length} : {node: el, offset: 0}
}

/** Where an expanded body sits: over its document pane's body, kept in step as it resizes. */
function useExpandArea(box: RefObject<HTMLDivElement | null>, on: boolean) {
  const [area, setArea] = useState<CSSProperties>()
  useLayoutEffect(() => {
    if (!on) return
    const pane = box.current?.closest('.pane-body')
    if (!pane) return
    const place = () => {
      const r = pane.getBoundingClientRect()
      setArea({position: 'fixed', top: r.top + 8, left: r.left + 8, width: r.width - 16, height: r.height - 16, zIndex: 40})
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(pane)
    addEventListener('resize', place)
    return () => (ro.disconnect(), removeEventListener('resize', place))
  }, [on, box])
  return area
}

/** J07: who else has their caret in this field. */
function FieldPresenceHere({path}: {path: string}) {
  const docId = useContext(DocIdContext)
  return docId ? <FieldPresence docId={docId} path={path} /> : null
}
