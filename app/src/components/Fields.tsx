import {createContext, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type RefObject} from 'react'
import {MenuPopover} from './FocusScopes'
import {anyDocQuery, refId, refTypesOf, type Doc, type Field} from '../lib/data'
import {refFilterOf} from '../lib/ref-filter'
import {useQueryClient} from '@tanstack/react-query'
import {usePaneNavigate} from './PaneLink'
import {isHidden, isReadOnly} from '../lib/conditions'
import {mapCaret} from '../lib/merge'
import {textDiff} from '../lib/changes'
import {FieldClashCard} from './FieldClash'
import {worst, type Level, type Problem} from '../lib/validation'
import {RefInput} from './RefInput'
import {ChevronDown, ResetCircle, ClipboardIcon, Copy, Ellipsis, ErrorOutline, Collapse, Expand, InfoOutline, ToggleArrowRight, WarningOutline} from './icons'
import {copy, isEmpty, read, signature, transfer} from '../lib/clipboard'
import {toast} from './Toasts'
import {BlockPresence, FieldPresence} from './Presence'
import {DateTimeInput, type DateOptions} from './DateTimeInput'
import {StringArrayInput, TagsInput} from './ArrayInputs'
import {ObjectArrayInput} from './ObjectArrayInput'
import {RefArrayInput} from './RefArrayInput'
import {ColorInput, LocalizedTextInput, ReadOnlyJson, SourceView} from './NativeInputs'
import {CodelistInput} from './CodelistInput'
import {FieldComments} from './Comments'
import {useStaticCommentHighlights} from './InlineComments'
import {InvalidValueCard, KeysAlert, RichTextCard, SanityPortableTextCard, UnsupportedAssetCard} from './BrokenValues'
import {invalidValue, keyProblem, richTextProblem, sanityPortableText, unsupportedAsset} from '../lib/broken'
import {FileInput, ImageInput, PortableDocEditor} from './DocEditors'
import {BodyToolbar} from './BodyToolbar'
import {PortableDocView} from './PortableDocView'
import {keptFor} from '../lib/kept-words'
import {slugify} from '../lib/slug'
import {decimalSeparator, parseNumber, typingNumber} from '../lib/number'
import {modKey, useTip} from './Tip'
import {intlTag, t as tBrowser, useLocale, useT} from '../lib/i18n'
import studio from '../studio.config'

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
/**
 * J15: top-level fields the draft changed since publish, and how to open Review changes.
 * J68: `inline` (Sanity's "Inline changes") also shows a changed text field's diff
 * against `published` in place.
 */
export const ChangesContext = createContext<{changed: Set<string>; review: () => void; inline?: boolean; published?: Record<string, unknown> | null} | null>(null)
/** The doc being edited, for inputs that read a sibling field (slug's source,
 *  conditional fields). It changes on every keystroke, so only those read it. */
export const DocContext = createContext<Doc | null>(null)
/** The object or array item the fields inside it belong to (a condition's `scope: "parent"`). */
export const ParentContext = createContext<Record<string, unknown> | undefined>(undefined)
import {DocIdContext, DocTypeContext} from './doc-ids'
export {DocIdContext, DocTypeContext}
/** J52: the field path the URL asks for (`path=`), so an array can open the item it sits in. */
export const UrlPathContext = createContext<string | undefined>(undefined)
/** The form is shut (the published version, a revision, a seat that may not write): its fieldset is disabled. */
export const FormDisabledContext = createContext(false)

const LEVEL_ICON: Record<Level, () => ReactElement> = {error: ErrorOutline, warning: WarningOutline, info: InfoOutline}
const LEVEL_WORD: Record<Level, string> = {error: 'Validation error', warning: 'Validation warning', info: 'Validation info'}

/** Sanity's mark for an error, warning or info: one icon per level, the message on hover. */
export function LevelIcon({level, label}: {level: Level; label?: string}) {
  const t = useT()
  const Icon = LEVEL_ICON[level]
  return (
    <span className="error-icon" data-level={level} role="img" aria-label={label || t(LEVEL_WORD[level])} title={label}>
      <Icon />
    </span>
  )
}

/** The mark beside a field label; `within`: also what a collapsed object hides. */
export function ProblemMark({path, within}: {path: string; within?: boolean}) {
  const t = useT()
  const all = useContext(ProblemsContext).filter((p) => p.path === path || (within && p.path.startsWith(`${path}.`)))
  const level = worst(all)
  if (!level) return null
  const problem = all.find((p) => p.level === level)!
  return <LevelIcon level={level} label={`${t(LEVEL_WORD[level])}: ${problem.message}`} />
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
  const parent = useContext(ParentContext)
  const hidden = !!doc && isHidden(props.field, doc, parent)
  useSteadyFocus(hidden)
  if (hidden) return null
  return <FieldBody {...props} readOnly={props.readOnly || (doc ? isReadOnly(props.field, doc, parent) : false)} />
}

/**
 * J30: a field that comes or goes above the control you just used (Featured brings
 * its note back above the switch) leaves that control where it was on screen, as
 * Sanity's does: its place is read while the field flips, and the pane scrolls by
 * however far it moved. Several fields flipping at once: the first scroll covers all.
 */
function useSteadyFocus(hidden: boolean) {
  const was = useRef(hidden)
  const before = useRef<{el: Element; top: number} | null>(null)
  if (was.current !== hidden) {
    was.current = hidden
    const el = typeof document === 'undefined' ? null : document.activeElement
    before.current = el && el !== document.body && el.closest('.pane-body') ? {el, top: el.getBoundingClientRect().top} : null
  }
  useLayoutEffect(() => {
    const b = before.current
    before.current = null
    if (!b || !b.el.isConnected) return
    const moved = b.el.getBoundingClientRect().top - b.top
    const scroller = b.el.closest('.pane-body')
    if (moved && scroller) scroller.scrollTop += moved
  }, [hidden])
}

/** An object (or an image): a fieldset, its title the legend. Collapsible ones fold, like Sanity's. */
function ObjectField(props: FieldProps & {label: string; titleId: string; changed: boolean; review?: () => void}) {
  const {label, titleId, changed, review, ...field} = props
  const options = (Array.isArray(field.field.options) ? {} : field.field.options ?? {}) as {collapsible?: boolean; collapsed?: boolean}
  const opened = useContext(OpenObjectsContext)
  const collapsible = !!options.collapsible || !!options.collapsed
  const open = !collapsible || (opened ? opened.isOpen(field.path, !options.collapsed) : !options.collapsed)
  return (
    <fieldset className="field object-field" data-collapsible={collapsible || undefined} data-open={collapsible ? open : undefined}>
      <FieldActions {...field} titleId={titleId} />
      <FieldComments path={field.path} title={label} titleId={titleId} />
      {changed && review && <ChangeBar onClick={review} />}
      <legend>
        {collapsible ? (
          <button type="button" className="object-toggle" aria-expanded={open} onClick={() => opened?.toggle(field.path, !open)}>
            <span className="toggle-arrow" data-open={open}>
              <ToggleArrowRight />
            </span>
            <span id={titleId}>{label}</span>
          </button>
        ) : (
          <span id={titleId}>{label}</span>
        )}
        <ProblemMark path={field.path} within={!open} />
        <FieldPresenceHere path={field.path} />
      </legend>
      {field.field.description && <p className="field-desc">{field.field.description}</p>}
      {open && <FieldInput {...field} />}
    </fieldset>
  )
}

function FieldBody(props: FieldProps) {
  if (props.field.readOnly === true) props = {...props, readOnly: true}
  const changes = useContext(ChangesContext)
  const label = props.field.title ?? props.field.name
  // The field's visible title: it describes the field's action and comment buttons (one per field, same names).
  const titleId = useId()
  const invalid = useContext(ProblemsContext).some((p) => p.path === props.path && p.level === 'error') || undefined
  // Sanity: a boolean is a switch with its label beside it, in a box.
  if (props.field.type === 'boolean' && !invalidValue(props.field, props.value))
    return (
      <div className="field">
        <FieldActions {...props} titleId={titleId} />
        <FieldComments path={props.path} title={label} titleId={titleId} />
        {changes?.changed.has(props.path) && <ChangeBar onClick={changes.review} />}
        <label className="bool-box">
          <FieldInput {...props} />
          <span id={titleId}>{label}</span>
        </label>
      </div>
    )
  // An object (or an image, with its own fields below it): a fieldset with its title as the legend.
  if (props.field.type === 'composite' || props.field.type === 'image' || props.field.type === 'geopoint')
    return (
      <ObjectField {...props} label={label} titleId={titleId} changed={!!changes?.changed.has(props.path)} review={changes?.review} />
    )
  return (
    <div className="field" data-invalid={invalid} data-readonly={props.readOnly || undefined}>
      <FieldActions {...props} titleId={titleId} />
      <FieldComments path={props.path} title={label} titleId={titleId} />
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
        <span id={titleId}>{label}</span>
        <ProblemMark path={props.path} />
        <FieldPresenceHere path={props.path} />
      </label>
      {props.field.description && <p className="field-desc" id={`${props.path}-desc`}>{props.field.description}</p>}
      <FieldClashCard path={props.path} />
      {changes?.inline && changes.changed.has(props.path) && INLINE_DIFF_TYPES.has(props.field.type) ? (
        <InlineDiff before={changes.published?.[props.path]} after={props.value} multiline={props.field.type === 'text' || props.field.type === 'markdown'}>
          <CustomOrDefault {...props} />
        </InlineDiff>
      ) : (
        <CustomOrDefault {...props} />
      )}
    </div>
  )
}

/** J68: the plain-text inputs Sanity's "Inline changes" marks in place. */
const INLINE_DIFF_TYPES = new Set(['string', 'url', 'email', 'text', 'markdown'])

/**
 * J68: a changed text field as Sanity's "Inline changes" draws it: the text with what
 * was removed since publish struck through and what was added marked. Laid over the
 * input, which takes the click; while you type, the plain input shows.
 */
function InlineDiff({before, after, multiline, children}: {before: unknown; after: unknown; multiline: boolean; children: ReactElement}) {
  const [editing, setEditing] = useState(false)
  const str = (v: unknown) => (v == null ? '' : String(v))
  return (
    <div className="inline-diff" onFocus={() => setEditing(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setEditing(false)}>
      {children}
      {!editing && (
        <div className="inline-diff-view" data-multiline={multiline || undefined} data-testid="inline-diff" aria-hidden="true">
          {textDiff(str(before), str(after)).map((seg, i) => (seg.kind === 'removed' ? <del key={i}>{seg.text}</del> : seg.kind === 'added' ? <ins key={i}>{seg.text}</ins> : <span key={i}>{seg.text}</span>))}
        </div>
      )}
    </div>
  )
}

/** J65: the studio config's input for this `type.path` (it can render the default), else the default. */
function CustomOrDefault(props: FieldProps) {
  const type = useContext(DocTypeContext)
  const Custom = type ? studio.form?.inputs?.[`${type}.${props.path}`] : undefined
  if (!Custom) return <FieldInput {...props} />
  return <Custom field={props.field} path={props.path} value={props.value} onChange={props.onChange} readOnly={props.readOnly} renderDefault={() => <FieldInput {...props} />} />
}

/** Sanity's change bar (J15): a thin line beside a field the draft changed; it opens Review changes. */
function ChangeBar({onClick}: {onClick: () => void}) {
  const t = useT()
  return <button type="button" className="change-bar" aria-label={t('Review changes')} title={t('Review changes')} onClick={onClick} />
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

function FieldActions({field, value, onChange, readOnly, titleId}: FieldProps & {titleId: string}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const doc = {id: useContext(DocIdContext) ?? undefined, type: useContext(DocTypeContext) ?? undefined}
  const doCopy = () => void copy({kind: 'field', field: {name: field.name, sig: signature(field), value}}, doc)
  // What the system clipboard holds now: anything but a copied field is nothing to paste (Sanity's info toast).
  const doPaste = async () => {
    const clip = await read()
    const item = clip?.kind === 'field' ? clip.field : undefined
    // Nothing copied, something else copied since, or an empty copy (kept by an older studio): nothing to paste.
    if (!item || isEmpty(item.value)) return toast({title: tBrowser('Nothing to paste')})
    const pasted = transfer(item, field, value)
    if ('why' in pasted) return toast({tone: 'critical', title: tBrowser('Invalid clipboard item'), description: pasted.why})
    onChange(pasted.value)
  }
  const latest = useRef({doCopy, doPaste, readOnly})
  latest.current = {doCopy, doPaste, readOnly}
  const wrap = useRef<HTMLDivElement | null>(null)
  const register = (el: HTMLDivElement | null) => {
    wrap.current = el
    const host = el?.parentElement
    if (host) fieldClipboard.set(host, {copy: () => latest.current.doCopy(), paste: () => !latest.current.readOnly && latest.current.doPaste()})
  }
  // Sanity's opens to the right of the button; with no room before the pane's edge (ours clips), above it.
  useLayoutEffect(() => {
    const menu = wrap.current?.querySelector<HTMLElement>('.field-menu')
    if (!menu) return
    const edge = Math.min(document.documentElement.clientWidth, menu.closest('.pane')?.getBoundingClientRect().right ?? Infinity)
    if (menu.getBoundingClientRect().right > edge) menu.dataset.side = 'top'
  }, [open])
  return (
    <div ref={register} className="field-actions" data-open={open || undefined} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn" aria-label={t('Field actions')} aria-describedby={titleId} data-tip={t('Field actions')} data-tip-side="top" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <MenuPopover className="popover menu field-menu" onClose={close} aria-label={t('Field actions')}>
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
              <Copy /> {t('Copy field')}
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
              <ClipboardIcon /> {t('Paste field')}
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
  const t = useT()
  const editPath = useContext(EditPathContext)
  const invalid = useContext(ProblemsContext).some((p) => p.path === path && p.level === 'error')
  // B14: Sanity Portable Text in a rich text field reads as its text, kept as it is.
  const pt = sanityPortableText(field, value)
  if (pt) return <SanityPortableTextCard pt={pt} value={value} onChange={onChange} />
  // J39: a stored value this input can't edit gets Sanity's fix-it card instead.
  const wrongType = invalidValue(field, value)
  if (wrongType) return <InvalidValueCard invalid={wrongType} value={value} onChange={onChange} />
  // An asset from elsewhere (a Sanity export, a Sanity asset id): kept as it is, never read as empty.
  const foreign = unsupportedAsset(field, value)
  if (foreign) return <UnsupportedAssetCard asset={foreign} value={value} onChange={onChange} />
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
      // Sanity-shaped data (an import) holds {current}; Barkpark a string.
      return <SlugInput id={path} value={value && typeof value === 'object' ? String((value as {current?: unknown}).current ?? '') : str} onChange={onChange} source={(field.options as {source?: string})?.source} maxLength={(field.options as {maxLength?: number})?.maxLength} readOnly={readOnly} />
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
      return <DateTimeInput id={path} value={str || undefined} onChange={onChange} readOnly={readOnly} dateOnly options={field.options as DateOptions | undefined} />
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
      return <DateTimeInput id={path} value={value as string | undefined} onChange={onChange} readOnly={readOnly} options={field.options as DateOptions | undefined} />
    case 'select':
      return <SelectInput id={path} field={field} value={value} onChange={onChange} />
    case 'boolean':
      // Sanity's `options.layout: 'checkbox'`: a checkbox instead of the switch.
      // Not set yet: Sanity draws the checkbox indeterminate (a dash), not unchecked.
      if ((field.options as {layout?: string} | undefined)?.layout === 'checkbox')
        return <input id={path} type="checkbox" className="checkbox" checked={!!value} ref={(el) => void (el && (el.indeterminate = value === undefined || value === null))} onChange={(e) => onChange(e.target.checked)} />
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
          filter={refFilterOf(field.options)}
          disableNew={!!(field.options as {disableNew?: boolean} | undefined)?.disableNew}
          // A Sanity-shaped reference ({_ref}, as an import from Sanity holds it) reads as its id.
          value={refId(value)}
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
      // Sanity: an array of strings with `options.list` is a set of checkboxes (a grid with layout 'grid').
      const choices = !Array.isArray(field.options) && Array.isArray(field.options?.list) ? (field.options.list as (string | {value: string; title?: string})[]) : undefined
      if (field.of?.type === 'string' && choices) return <CheckboxList id={path} choices={choices} grid={(!Array.isArray(field.options) && field.options?.layout === 'grid') || field.layout === 'grid'} value={items} onChange={onChange} readOnly={readOnly} />
      if (field.of?.type === 'string' || field.of?.type === 'text')
        return (field.options as {layout?: string} | undefined)?.layout === 'tags' ? (
          <TagsInput id={path} value={value} onChange={onChange} readOnly={readOnly} />
        ) : (
          <StringArrayInput id={path} value={value} onChange={onChange} readOnly={readOnly} />
        )
      if (field.of?.type === 'composite' || field.of?.type === 'image') return <ObjectArrayInput id={path} field={field} value={value} onChange={onChange} readOnly={readOnly} openRef={openRef} />
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
    case 'geopoint':
    case 'composite': {
      // Sanity's geopoint is an object of three numbers (no map without its plugin).
      const fields = field.type === 'geopoint' ? GEOPOINT.map((f) => ({...f, title: t(f.title!)})) : (field.fields ?? [])
      const sub = (f: Field) => (
        <FieldView
          key={f.name}
          field={readOnly ? {...f, readOnly: true} : f}
          path={`${path}.${f.name}`}
          value={(value as Record<string, unknown>)?.[f.name]}
          openRef={openRef}
          // Barkpark patches paths (task-bfb66a2ff491f6e7): a subfield edit sends
          // only its own path, so two editors on different subfields both keep theirs.
          onChange={(v) =>
            field.type === 'geopoint'
              ? onChange({_type: 'geopoint', ...(value as Record<string, unknown>), [f.name]: v})
              : editPath
                ? editPath(`${path}.${f.name}`, v)
                : onChange({...(value as Record<string, unknown>), [f.name]: v})
          }
        />
      )
      return (
        <div className="fieldset" id={path}>
          <ParentContext.Provider value={(value as Record<string, unknown> | undefined) ?? {}}>
            {inFieldsets(fields, field.fieldsets).map((g) => ('set' in g ? <Fieldset key={`fs:${g.set.name}`} path={`${path}.${g.set.name}`} fieldset={g.set}>{g.fields.map(sub)}</Fieldset> : sub(g)))}
          </ParentContext.Provider>
        </div>
      )
    }
    case 'richText': {
      const broken = richTextProblem(value)
      if (broken) return <RichTextCard problem={broken} onChange={onChange} />
      // J10: a block-editor field is Barkpark's canvas (decision 0004), scoped to the field.
      return field.editor === 'blocks' && !path.includes('.') ? <BodyCanvas field={path} title={field.title ?? field.name} value={value} vocabulary={(field as {blocks?: unknown}).blocks} readOnly={readOnly} openRef={openRef} /> : <RichText id={path} value={value} />
    }
    case 'image':
      return <ImageInput id={path} field={field} value={value} onChange={onChange} readOnly={readOnly} openRef={openRef} />
    case 'file':
      return <FileInput id={path} field={field} value={value} onChange={onChange} readOnly={readOnly} openRef={openRef} />
    default:
      // A type this Studio has no editor for: never "[object Object]".
      return value !== null && typeof value === 'object' ? <ReadOnlyJson id={path} value={value} note={t('read-only — no editor for this field type yet')} /> : <input id={path} className="input" readOnly value={str} />
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
    <textarea ref={ref} id={id} className="input" rows={rows} value={local} readOnly={readOnly} onChange={(e) => change(e.target.value)} onKeyDown={keepPaneStill} />
  ) : (
    <input ref={ref} id={id} className="input" value={local} readOnly={readOnly} onChange={(e) => change(e.target.value)} onKeyDown={keepPaneStill} />
  )
}

/**
 * Home/End with the caret already at that end (of its line, in a text area) do nothing
 * in the field, so the browser scrolls the pane instead (a jump Sanity doesn't make; J20's
 * excerpt, End then typing, showed Main image and Body for a moment). Swallow those.
 */
function keepPaneStill(e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const el = e.currentTarget
  const at = el.selectionStart
  if (at === null || at !== el.selectionEnd) return
  // Ctrl/Cmd+Home/End go to the whole text's end, plain Home/End to the line's.
  const whole = e.ctrlKey || e.metaKey
  const atEnd = at === el.value.length || (!whole && el.value[at] === '\n')
  const atStart = at === 0 || (!whole && el.value[at - 1] === '\n')
  if ((e.key === 'End' && atEnd) || (e.key === 'Home' && atStart)) e.preventDefault()
}

/** A slug: a text input plus Sanity's Generate, from the field named in options.source. */
// `maxLength`: Sanity's slug option, cutting a generated slug (its default is 200).
function SlugInput({id, value, onChange, source, maxLength = 200, readOnly}: {id: string; value: string; onChange: (v: unknown) => void; source?: string; maxLength?: number; readOnly?: boolean}) {
  const t = useT()
  const doc = useContext(DocContext)
  const from = source && doc ? doc[source] : undefined
  const [, force] = useState(0)
  return (
    <div className="slug-row">
      <TextInput id={id} value={value} onChange={onChange} readOnly={readOnly} />
      {source && (
        <button
          type="button"
          className="btn-create btn-generate"
          // Sanity's stays enabled with an empty source; the click then does nothing.
          disabled={readOnly}
          onClick={() => typeof from === 'string' && from && void slugify(from, maxLength).then((slug) => (onChange(slug), force((n) => n + 1)))}
        >
          {t('Generate')}
        </button>
      )}
    </div>
  )
}

const GEOPOINT: Field[] = [
  {name: 'lat', title: 'Latitude', type: 'number'},
  {name: 'lng', title: 'Longitude', type: 'number'},
  {name: 'alt', title: 'Altitude', type: 'number'},
]

type FieldsetDef = NonNullable<Field['fieldsets']>[number]
/** Sanity's fieldsets: fields that name one show together, in the order the first of them comes. */
export function inFieldsets(fields: Field[], fieldsets: Field['fieldsets'] = []): (Field | {set: FieldsetDef; fields: Field[]})[] {
  const out: (Field | {set: FieldsetDef; fields: Field[]})[] = []
  const groups = new Map<string, {set: FieldsetDef; fields: Field[]}>()
  for (const f of fields) {
    const def = f.fieldset ? fieldsets.find((s) => s.name === f.fieldset) : undefined
    if (!def) out.push(f)
    else if (groups.has(def.name)) groups.get(def.name)!.fields.push(f)
    else (groups.set(def.name, {set: def, fields: [f]}), out.push(groups.get(def.name)!))
  }
  return out
}

/** One fieldset: its title (a fold when collapsible) and its fields, in `columns` columns. */
export function Fieldset({path, fieldset, children}: {path: string; fieldset: FieldsetDef; children: ReactNode}) {
  const opened = useContext(OpenObjectsContext)
  const {collapsible = false, collapsed = false, columns} = fieldset.options ?? {}
  const open = !(collapsible || collapsed) || (opened ? opened.isOpen(path, !collapsed) : !collapsed)
  const title = fieldset.title ?? fieldset.name
  return (
    <fieldset className="field object-field fieldset-group" data-collapsible={collapsible || collapsed || undefined} data-open={collapsible || collapsed ? open : undefined}>
      <legend>
        {collapsible || collapsed ? (
          <button type="button" className="object-toggle" aria-expanded={open} onClick={() => opened?.toggle(path, !open)}>
            <span className="toggle-arrow" data-open={open}>
              <ToggleArrowRight />
            </span>
            {title}
          </button>
        ) : (
          title
        )}
      </legend>
      {open && (
        <div className="fieldset" style={columns && columns > 1 ? {display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: 20} : undefined}>
          {children}
        </div>
      )}
    </fieldset>
  )
}

/** An array of strings picked from a list: one checkbox each (Sanity's), in a row of three with layout 'grid'. */
function CheckboxList({id, choices, grid, value, onChange, readOnly}: {id: string; choices: (string | {value: string; title?: string})[]; grid: boolean; value: unknown[]; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const opts = choices.map((c) => (typeof c === 'string' ? {value: c, title: c} : {value: c.value, title: c.title ?? c.value}))
  const set = new Set(value.map(String))
  const toggle = (v: string, on: boolean) => {
    const next = opts.map((o) => o.value).filter((o) => (o === v ? on : set.has(o)))
    onChange(next.length ? next : undefined)
  }
  return (
    <div className="checkbox-list" id={id} role="group" data-grid={grid || undefined}>
      {opts.map((o) => (
        <label key={o.value} className="checkbox-item">
          <input type="checkbox" className="checkbox" checked={set.has(o.value)} disabled={readOnly} onChange={(e) => toggle(o.value, e.target.checked)} />
          <span>{o.title}</span>
        </label>
      ))}
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
 * Sanity's string list (J31): `layout: "radio"` is a stacked list of radios in a box
 * with a reset button on the chosen row; otherwise a dropdown whose blank first option means "no value".
 */
function SelectInput({id, field, value, onChange}: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void}) {
  const t = useT()
  const options = optionsOf(field)
  if (field.layout === 'radio') {
    // Sanity stacks the options unless `options.direction` is "horizontal"; its reset button sits on the chosen row.
    const horizontal = !Array.isArray(field.options) && field.options?.direction === 'horizontal'
    const clear = value !== undefined && (
      <button type="button" className="icon-btn" aria-label={t('Clear')} title={t('Clear')} onClick={() => onChange(undefined)}>
        <ResetCircle />
      </button>
    )
    return (
      <div className="radio-box" data-direction={horizontal ? 'horizontal' : 'vertical'}>
        <div role="group" aria-labelledby={`${id}-label`} id={id}>
          {options.map((o) => (
            <div key={String(o.value)} className="radio-row">
              <label className="radio">
                <input type="radio" name={id} checked={value === o.value} onChange={() => onChange(o.value)} />
                <span>{o.title}</span>
              </label>
              {!horizontal && value === o.value && clear}
            </div>
          ))}
        </div>
        {horizontal && clear}
      </div>
    )
  }
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
  // The studio's language decides the decimal separator (lib/number.ts): "1,5" is 1.5 in nb;
  // in English "1,500" is not a number, so the field is unset and keeps what was typed.
  const decimal = decimalSeparator(intlTag(useLocale()))
  const parse = (s: string) => parseNumber(s, decimal)
  const shown = text !== null && (parse(text) === value || (value == null && !Number.isFinite(parse(text)))) ? text : value == null ? '' : String(value)
  return (
    <input
      id={id}
      className="input"
      // The phone's number pad: digits only for integers.
      inputMode={integer ? 'numeric' : 'decimal'}
      value={shown}
      onChange={(e) => {
        setText(e.target.value)
        const n = parse(e.target.value)
        // Not a number (yet): a sign or a separator so far, or "1,500" in English. The field is
        // unset, as Sanity's number input leaves it, and the text stays.
        if (e.target.value === '' || typingNumber(e.target.value, decimal) || !Number.isFinite(n)) onChange(undefined)
        else if (!integer || Number.isInteger(n)) onChange(n)
      }}
    />
  )
}

// An inline object (J11, post-11's chip) carries its words in `text`.
type Inline = {type: string; value?: string; text?: string; children?: Inline[]}
type Block = {id: string; type: string; level?: number; tone?: string; content?: Inline[]}
const text = (nodes: Inline[] = []): string => nodes.map((n) => n.value ?? n.text ?? text(n.children)).join('')

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
function BodyCanvas({field, title, value, vocabulary, readOnly, openRef}: {field: string; title: string; value: unknown; vocabulary?: unknown; readOnly?: boolean; openRef: OpenRef}) {
  const t = useT()
  const id = useContext(DocIdContext)
  const type = useContext(DocTypeContext)
  // D06, as Sanity's: an internal link opens its document in the next pane, from the
  // canvas's link card (Open) and, in a read-only body, from the link itself.
  const qc = useQueryClient()
  const navigate = usePaneNavigate()
  const openDoc = useCallback((docId: string, docType: string) => void navigate({href: openRef(docType, docId, '').href}), [navigate, openRef])
  // A body that can't be edited (read-only, or a shut form) follows its internal links itself.
  const linksOpen = useContext(FormDisabledContext) || !!readOnly
  const follow = (docId: string) =>
    void qc.fetchQuery(anyDocQuery(docId)).then((doc) => (doc ? openDoc(docId, doc._type) : toast({tone: 'critical', title: t('This link points to a document that does not exist'), description: docId})))
  const [active, setActive] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const area = useExpandArea(box, expanded)
  // Inline comments show on the read-only view too, and a click on one opens its thread.
  const staticBody = useRef<HTMLDivElement>(null)
  const pickComment = useStaticCommentHighlights(staticBody, field, !active, value)
  // Where the activating click landed, as (block id, text offset): the caret goes
  // there once the canvas is up (one click activates and places it). By keyboard:
  // the end of the text. Mapped by block, not by pixel: the canvas lays out a
  // little differently from the read-only view.
  const at = useRef<{block: string; offset: number} | null>(null)
  // F8: what is typed between the activating click (or key) and the canvas taking the
  // caret (its bundle and the blocks are still loading) is kept here and typed in once
  // it can take it — never dropped (it was, on a fresh page load: task-1dd00fd2a0dc1c60).
  // Text, Enter as a paragraph break, and the caret moves an author makes before typing
  // (line start and end, the arrows, Backspace: task-6a29d198c08c9123), in the order typed.
  const typed = useRef<string[]>([])
  // The read-only body scrolls inside its box: the canvas opens scrolled (and sized,
  // when its corner was dragged) the same.
  const scrolled = useRef({top: 0, height: ''})
  // J59: a link to one of its blocks (`body[_key=="p1"]`, a click in Presentation's preview)
  // wakes the canvas with the caret at that block's start, as Sanity opens that paragraph.
  const urlPath = useContext(UrlPathContext)
  // D21: words a save never got to Barkpark are kept on this computer, and the canvas offers
  // them back when it opens. The body opens itself for that (not focused), or the offer would
  // wait for a click into it (closed offline, reopened: the long-offline run).
  const quiet = useRef(false)
  useEffect(() => {
    if (!readOnly && id && type && keptFor(type, id, field)) (quiet.current = true), setActive(true)
  }, [id, type, field, readOnly])
  useEffect(() => {
    const key = urlPath?.match(new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[_key=="([^"]+)"\\]$`))?.[1]
    if (!key || readOnly) return
    at.current = {block: key, offset: 0}
    setActive(true)
    box.current?.scrollIntoView({block: 'center'})
  }, [urlPath, field, readOnly])
  useEffect(() => {
    if (!active) return
    const wokeFrom = document.activeElement
    // Until the caret is where the click put it, every key is kept here: before, one could
    // reach the canvas the moment it took focus, at its own first caret (task-6a29d198c08c9123).
    let placed = false
    const keep = (e: KeyboardEvent) => {
      if (placed || e.altKey || e.isComposing) return
      // Keys for another field the author went to meanwhile are that field's, not the body's.
      const at = document.activeElement
      if (at && at !== document.body && !box.current?.contains(at)) return
      const move = caretMove(e)
      if ((e.metaKey || e.ctrlKey) && !move) return
      const last = typed.current.length - 1
      const text = (s: string | undefined) => s !== undefined && !s.startsWith(MOVE) && s !== '\n'
      if (move) typed.current.push(move)
      else if (e.key.length === 1) text(typed.current[last]) ? (typed.current[last] += e.key) : typed.current.push(e.key)
      else if (e.key === 'Enter') typed.current.push('\n')
      else if (e.key === 'Backspace') typed.current[last] === '\n' || (text(typed.current[last]) && typed.current[last]!.length === 1) ? typed.current.pop() : text(typed.current[last]) ? (typed.current[last] = typed.current[last]!.slice(0, -1)) : typed.current.push(BACKSPACE)
      else return
      e.preventDefault()
    }
    addEventListener('keydown', keep, true)
    let gone = false
    const timer = setInterval(() => {
      const pm = box.current?.querySelector<HTMLElement>('.ProseMirror')
      if (!pm) return
      clearInterval(timer)
      const done = () => ((placed = true), removeEventListener('keydown', keep, true))
      if (quiet.current && !typed.current.length) return void (done(), (quiet.current = false))
      quiet.current = false
      // The author went to another field while it woke (J10): the caret stays there. What
      // was typed for the body before that still goes in, and the focus goes back. A wake
      // from elsewhere (J59: Presentation's click on a paragraph) still takes the caret.
      const now = document.activeElement as HTMLElement | null
      const elsewhere = !!now && now !== wokeFrom && now !== document.body && !box.current?.contains(now)
      if (elsewhere && !typed.current.length) return done()
      const sel = getSelection()
      if (!pm.contains(document.activeElement)) {
        const scroller = box.current?.querySelector<HTMLElement>('.pd-canvas')
        if (scroller) (scroller.style.height = scrolled.current.height), (scroller.scrollTop = scrolled.current.top)
        pm.focus({preventScroll: !!scrolled.current.top})
      }
      // A caret the script moves reaches the canvas with the selectionchange after it; a key
      // replayed before that acts on the canvas's own caret (at the start, when it took the
      // focus itself as it came up: task-6a29d198c08c9123). Back in another field, at once.
      const read = () =>
        elsewhere ? Promise.resolve() : new Promise<void>((r) => (document.addEventListener('selectionchange', () => r(), {once: true}), setTimeout(r, 150)))
      void (async () => {
        // The click's spot, even when the canvas took the focus itself. By keyboard, or
        // below the text: the end, typed at once as before; read first, the canvas puts an
        // Enter there inside the last block's trailing break ("Two\n", J10).
        const target = at.current && caretIn(pm.querySelector<HTMLElement>(`[data-bp-id="${CSS.escape(at.current.block)}"]`), at.current.offset)
        if (sel && target) sel.collapse(target.node, target.offset), await read()
        else if (sel) sel.selectAllChildren(pm), sel.collapseToEnd()
        // The canvas reads it as typed input (beforeinput), so it saves and undoes as typing
        // does. Keys typed meanwhile join the queue, in order.
        for (let run = typed.current.shift(); run !== undefined && !gone; run = typed.current.shift()) {
          const move = MOVES[run]
          if (move) sel?.modify('move', ...move), await read()
          else if (run === BACKSPACE) document.execCommand('delete')
          else document.execCommand(run === '\n' ? 'insertParagraph' : 'insertText', false, run === '\n' ? undefined : run)
        }
        done()
        if (elsewhere && !gone) now.focus()
      })()
    }, 30)
    return () => ((gone = true), clearInterval(timer), removeEventListener('keydown', keep, true))
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
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) return
          const link = linksOpen ? (e.target as HTMLElement).closest<HTMLElement>('[data-wikilink][data-doc-id]') : null
          if (link) return follow(link.dataset.docId!)
          const spot = clickedAt(e.clientX, e.clientY)
          scrolled.current.height = staticBody.current?.style.height ?? ''
          pickComment(spot)
          if (!readOnly) (at.current = spot), setActive(true)
        }}
        // Keys on the box itself; Enter or Space on the expand button is that button's own click.
        onKeyDown={(e) => {
          const link = linksOpen && e.key === 'Enter' ? (e.target as HTMLElement).closest<HTMLElement>('[data-wikilink][data-doc-id]') : null
          if (link) return e.preventDefault(), follow(link.dataset.docId!)
          if (readOnly || e.target !== e.currentTarget) return
          // J35: Cmd/Ctrl+Enter opens it expanded, as Sanity's hotkey.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return e.preventDefault(), setActive(true), setExpanded(true)
          if ((e.key === 'Enter' || e.key.length === 1) && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            if (e.key.length === 1) typed.current = [e.key] // the key that wakes it is typed too
            setActive(true)
          }
        }}
      >
        <div className="body-bar">
          {!readOnly && <BodyToolbar host={box} vocabulary={vocabulary} onWake={() => setActive(true)} />}
          {!readOnly && <ExpandButton expanded={false} onClick={(e) => (e.stopPropagation(), setActive(true), setExpanded(true))} />}
        </div>
        <div className="bp-paper-editor-body" ref={staticBody} onScroll={(e) => (scrolled.current.top = e.currentTarget.scrollTop)}>{blocks.length ? <PortableDocView blocks={blocks} linksOpen={linksOpen} /> : <p className="muted">{t('Empty')}</p>}</div>
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
      onMouseMove={(e) => markObjectHover(e.currentTarget, e.target as Element)}
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
      <div className="body-bar">
        {!readOnly && <BodyToolbar host={box} vocabulary={vocabulary} />}
        <ExpandButton expanded={expanded} aria-pressed={expanded} onMouseDown={(e) => e.preventDefault()} onClick={toggle} />
      </div>
      <PortableDocEditor type={type} id={id} field={field} vocabulary={vocabulary} labelledBy={`${field}-label`} editable={!readOnly} commentsTitle={title} openDoc={openDoc} />
      {id && <BlockPresence docId={id} field={field} />}
    </div>
  )
}

/**
 * J11, Sanity's inline body: a text block shows no gutter, a block object (callout, image)
 * offers its menu at its own right edge. The canvas has one shared block handle and does
 * not say which block it is on, so the field marks when the pointer is on a top-level
 * object (`data-hover-object`) and CSS shows the handle there as that object's "…". On the
 * handle or its menu the mark stays.
 */
function markObjectHover(field: HTMLElement, target: Element) {
  if (target.closest('.bp-block-handle, .bp-block-menu')) return
  const doc = target.closest('.ProseMirror')
  let block: Element | null = doc ? target : null
  while (block && block.parentElement !== doc) block = block.parentElement
  // An image card (canvas 1.11.0) carries its own "…" (Edit, Remove), as Sanity's: no second one.
  const ownMenu = !!block?.querySelector(':scope > .bp-canvas-image-head')
  field.toggleAttribute('data-hover-object', !!block && !ownMenu && !/^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/.test(block.tagName))
}

/** The body's expand button; its tooltip names the hotkey (J35, Sanity's "Expand editor ⌘ Enter"). */
function ExpandButton({expanded, ...rest}: {expanded: boolean} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const t = useT()
  const label = expanded ? t('Collapse editor') : t('Expand editor')
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

// Caret moves kept while the body wakes (they start with MOVE, which no typed text can):
// as Selection.modify takes them.
const MOVE = '\u0000'
const BACKSPACE = `${MOVE}backspace`
const MOVES: Record<string, [direction: 'forward' | 'backward', unit: 'character' | 'line' | 'lineboundary']> = {
  [`${MOVE}end`]: ['forward', 'lineboundary'],
  [`${MOVE}home`]: ['backward', 'lineboundary'],
  [`${MOVE}right`]: ['forward', 'character'],
  [`${MOVE}left`]: ['backward', 'character'],
  [`${MOVE}down`]: ['forward', 'line'],
  [`${MOVE}up`]: ['backward', 'line'],
}
/** The kept caret move for a key: End and Home (Cmd+Right and Cmd+Left on a Mac), the arrows. */
function caretMove(e: KeyboardEvent) {
  if (e.shiftKey) return null
  const line = e.metaKey && !e.ctrlKey
  if (e.key === 'End' || (line && e.key === 'ArrowRight')) return `${MOVE}end`
  if (e.key === 'Home' || (line && e.key === 'ArrowLeft')) return `${MOVE}home`
  if (e.metaKey || e.ctrlKey) return null
  const arrow = {ArrowRight: 'right', ArrowLeft: 'left', ArrowDown: 'down', ArrowUp: 'up'}[e.key]
  return arrow ? `${MOVE}${arrow}` : null
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

/** Where an expanded body sits: flush over its document pane's body (Sanity's), kept in step as it resizes. */
function useExpandArea(box: RefObject<HTMLDivElement | null>, on: boolean) {
  const [area, setArea] = useState<CSSProperties>()
  useLayoutEffect(() => {
    if (!on) return
    const pane = box.current?.closest('.pane-body')
    if (!pane) return
    const place = () => {
      const r = pane.getBoundingClientRect()
      setArea({position: 'fixed', top: r.top, left: r.left, width: r.width, height: r.height, zIndex: 40})
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
