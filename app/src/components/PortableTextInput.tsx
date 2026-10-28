import {createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {
  defineAnnotation,
  defineBlockObject,
  defineDecorator,
  defineInlineObject,
  defineTextBlock,
  EditorProvider,
  PortableTextEditable,
  useEditor,
  useEditorSelector,
  type EditorEmittedEvent,
  type PortableTextBlock,
  type RegistrableNode,
} from '@portabletext/editor'
import {EventListenerPlugin, NodePlugin} from '@portabletext/editor/plugins'
import {MarkdownShortcutsPlugin} from '@portabletext/plugin-markdown-shortcuts'
import {PasteLinkPlugin, type LinkMatcher} from '@portabletext/plugin-paste-link'
import {createDecoratorGuard, TypographyPlugin} from '@portabletext/plugin-typography'
import {getActiveAnnotations, getActiveStyle, getFocusTextBlock, isActiveAnnotation, isActiveDecorator, isActiveListItem, isSelectionCollapsed, isSelectionExpanded} from '@portabletext/editor/selectors'
import {useQuery} from '@tanstack/react-query'
import {schemasQuery, type Field} from '../lib/data'
import {useT} from '../lib/i18n'
import {declaredVocabulary, editorSchema, equal, insertable, isOutsideValue, markdownNames, mergeValue, newKey, objectChanges, objectFields, objectTitle, offeredAnnotations, pastesLinks, storedShape, type PtBlock, type PtSchema, type SchemaLike} from '../lib/pt-value'
import {BlockObjectDialog, type BlockObjectRequest} from './BlockObjectDialog'
import type {OpenRef} from './Fields'
import {MenuPopover} from './FocusScopes'
import {Add, BoldIcon, CodeIcon, EditIcon, ItalicIcon, LinkIcon, OlistIcon, StrikeIcon, Trash, UlistIcon, UnderlineIcon} from './icons'

// S4a (task-7f77f41c95cc6d9f): a richText field holding Portable Text, edited with
// @portabletext/editor (owner decision D2). Text, styles, lists and decorators edit.
// S4b: annotations add, edit and go, in a dialog of the annotation's fields (lib/pt-value.ts
// says where they come from); a reference field is the studio's reference input.
// S4c: Insert adds a declared custom block or inline object; Edit on one opens its fields
// in BlockObjectDialog, the named type's fields where the field declares none.
// A save sets the whole field (lib/edits.ts, fenced on the doc's rev) with every block
// and span the author did not touch exactly as it was stored (lib/pt-value.ts).

const STYLE_LABEL: Record<string, string> = {normal: 'Normal', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', blockquote: 'Quote'}
const MARKS: Record<string, [label: string, icon: () => ReactNode]> = {
  strong: ['Strong', BoldIcon],
  em: ['Italic', ItalicIcon],
  code: ['Code', CodeIcon],
  underline: ['Underline', UnderlineIcon],
  'strike-through': ['Strike', StrikeIcon],
}
const LISTS: Record<string, [label: string, icon: () => ReactNode]> = {
  bullet: ['Bulleted list', UlistIcon],
  number: ['Numbered list', OlistIcon],
}

const textBlock = defineTextBlock({
  type: 'block',
  render: ({attributes, children, node}) => {
    const style = node.style ?? 'normal'
    const props = {...attributes, className: 'pt-block', 'data-style': style, 'data-list': node.listItem, 'data-level': node.listItem ? (node.level ?? 1) : undefined}
    if (/^h[1-6]$/.test(style)) {
      const H = style as 'h1'
      return <H {...props}>{children}</H>
    }
    if (style === 'blockquote') return <blockquote {...props}>{children}</blockquote>
    return <div {...props}>{children}</div>
  },
})
const decorators = defineDecorator({
  type: '*',
  render: ({children, decorator}) => {
    if (decorator === 'strong') return <strong>{children}</strong>
    if (decorator === 'em') return <em>{children}</em>
    if (decorator === 'code') return <code>{children}</code>
    if (decorator === 'underline') return <u>{children}</u>
    if (decorator === 'strike-through') return <s>{children}</s>
    return <span data-mark={decorator}>{children}</span>
  },
})
// An annotation shows as marked text; the toolbar's button for its type edits it.
const annotations = defineAnnotation({
  type: '*',
  render: ({annotation, children}) => (
    <span className="pt-annotation" data-annotation={annotation._type} title={annotation._type}>
      {children}
    </span>
  ),
})

type ObjectKind = 'block' | 'inline'
type Obj = Record<string, unknown> & {_type: string; _key: string}
type ObjectEdit = {kind: ObjectKind; node: Obj; path: unknown[]}
/** Opens the dialog for a custom block or inline object (Editor holds it). */
const EditObject = createContext<((edit: ObjectEdit) => void) | null>(null)
/** Each annotation type's toolbar Edit, by name: the popover over an annotation opens it too. */
const AnnotationOpeners = createContext<Map<string, () => void> | null>(null)

/** A short line of an object's own text for its card: its first non-empty string, else one a field object holds. */
function preview(node: Obj): string {
  const first = (o: object) => Object.entries(o).find(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim())?.[1] as string | undefined
  const nested = Object.entries(node).filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object' && !Array.isArray(v))
  return (first(node) ?? nested.map(([, v]) => first(v as object)).find(Boolean) ?? '').trim()
}

/** A custom block: its type's title, a line of its text, and Edit (a double click too). */
function BlockCard({node, path, title, readOnly, attributes, children}: {node: Obj; path: unknown[]; title: string; readOnly: boolean; attributes: Record<string, unknown>; children: ReactNode}) {
  const t = useT()
  const edit = useContext(EditObject)
  const open = () => !readOnly && edit?.({kind: 'block', node, path})
  const label = t('Edit {name}', {name: title})
  const line = preview(node)
  return (
    <div {...attributes} className="pt-object" data-type={node._type} onDoubleClick={open}>
      {children}
      <span className="pt-object-head" contentEditable={false}>
        <span className="pt-object-label">{title}</span>
        {line && <span className="pt-object-preview">{line}</span>}
        {!readOnly && edit && (
          <button type="button" className="icon-btn pt-object-edit" aria-label={label} data-tip={label} data-tip-side="top" onClick={open}>
            <EditIcon />
          </button>
        )}
      </span>
    </div>
  )
}

/** An inline object: its type's title (and a line of its text); a click opens it. */
function InlineChip({node, path, title, readOnly, attributes, children}: {node: Obj; path: unknown[]; title: string; readOnly: boolean; attributes: Record<string, unknown>; children: ReactNode}) {
  const t = useT()
  const edit = useContext(EditObject)
  const line = preview(node)
  return (
    <span {...attributes} className="pt-inline-object" data-type={node._type}>
      {children}
      <span
        contentEditable={false}
        role={readOnly || !edit ? undefined : 'button'}
        tabIndex={readOnly || !edit ? undefined : -1}
        aria-label={readOnly || !edit ? undefined : t('Edit {name}', {name: title})}
        onClick={() => !readOnly && edit?.({kind: 'inline', node, path})}
      >
        {line ? `${title}: ${line}` : title}
      </span>
    </span>
  )
}

/** Custom blocks and inline objects: a card and a chip by type, each opening its dialog. */
function objectNodes(schema: PtSchema, title: (kind: ObjectKind, name: string) => string): RegistrableNode[] {
  return [
    ...schema.blockObjects.map((o) =>
      defineBlockObject({
        type: o.name as 'x',
        render: ({attributes, children, node, path, readOnly}) => (
          <BlockCard node={node as Obj} path={path} title={title('block', o.name)} readOnly={readOnly} attributes={attributes}>
            {children}
          </BlockCard>
        ),
      }),
    ),
    ...schema.inlineObjects.map((o) =>
      defineInlineObject({
        type: o.name as 'x',
        render: ({attributes, children, node, path, readOnly}) => (
          <InlineChip node={node as Obj} path={path} title={title('inline', o.name)} readOnly={readOnly} attributes={attributes}>
            {children}
          </InlineChip>
        ),
      }),
    ),
  ]
}

type Props = {id: string; field: Field; value: PtBlock[] | undefined; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}

export default function PortableTextInput(props: Props) {
  // A value from elsewhere (another editor, a restore, Discard changes) remounts the
  // editor on it; this input's own saves coming back do not. `mine` is what this input has sent.
  const mine = useRef<unknown[]>([])
  const [base, setBase] = useState(() => ({value: props.value ?? [], n: 0}))
  const focused = useRef(false)
  // A blur looks again at a value that came in while the author was typing.
  const [blurs, setBlurs] = useState(0)
  const incoming = props.value ?? []
  useEffect(() => {
    if (!isOutsideValue(incoming, mine.current.at(-1) ?? base.value, mine.current)) return
    // Not while the author is typing: the field's own save merges theirs (lib/edits.ts).
    if (focused.current) return
    mine.current = []
    setBase((b) => ({value: incoming, n: b.n + 1}))
  }, [incoming, base.value, blurs])
  // The editor's schema names every field an annotation may hold, some of them read off the
  // schemas (a reference's targets): it mounts once they are here (the form has them already).
  const {data: schemas} = useQuery(schemasQuery)
  if (!schemas) return null
  // The editor takes readOnly once, when it mounts: a change remounts it.
  return <Editor key={`${base.n}-${!!props.readOnly}`} {...props} schemas={schemas} stored={base.value} mine={mine} focused={focused} onBlur={() => setBlurs((n) => n + 1)} />
}

type Shared = {mine: {current: unknown[]}; focused: {current: boolean}; onBlur: () => void}

function Editor({id, field, stored, schemas, onChange, readOnly, openRef, mine, focused, onBlur}: Props & Shared & {stored: PtBlock[]; schemas: SchemaLike[]}) {
  const t = useT()
  const schema = useMemo(() => editorSchema(field, stored, schemas), [field, stored, schemas])
  const nodes = useMemo(() => [textBlock, decorators, annotations, ...objectNodes(schema, (kind, name) => objectTitle(field, kind, name, schemas))], [schema, field, schemas])
  const [objectEdit, setObjectEdit] = useState<ObjectEdit | null>(null)
  // A value the editor can't read: it stays read-only and nothing is saved from it.
  const [invalid, setInvalid] = useState(false)
  // The toolbar waits for the editor to have read the value (its 'ready').
  const [ready, setReady] = useState(false)
  const locked = readOnly || invalid
  const openers = useMemo(() => new Map<string, () => void>(), [])
  return (
    <div className="pt-input" data-readonly={locked || undefined} data-ready={ready || undefined}>
      <EditorProvider initialConfig={{schemaDefinition: schema, initialValue: stored as PortableTextBlock[], readOnly: locked}}>
        <NodePlugin nodes={nodes} />
        {!locked && <SanityPlugins field={field} stored={stored} />}
        <Saver stored={stored} onChange={invalid ? () => {} : onChange} onInvalid={() => setInvalid(true)} onReady={() => setReady(true)} mine={mine} focused={focused} onBlur={onBlur} />
        {invalid && (
          <p className="pt-note" role="status">
            {t('This text holds content the editor cannot read. It is shown read-only and kept as it is.')}
          </p>
        )}
        <EditObject.Provider value={locked ? null : setObjectEdit}>
          <AnnotationOpeners.Provider value={openers}>
            {!locked && <Toolbar id={id} field={field} stored={stored} schemas={schemas} openRef={openRef} ready={ready} />}
            <PortableTextEditable id={id} className="pt-editable" aria-labelledby={`${id}-label`} />
            {!locked && <AnnotationPopover field={field} />}
          </AnnotationOpeners.Provider>
        </EditObject.Provider>
        {objectEdit && <ObjectDialog id={id} edit={objectEdit} field={field} stored={stored} schemas={schemas} openRef={openRef} onClose={() => setObjectEdit(null)} />}
      </EditorProvider>
    </div>
  )
}

// Smart quotes, dashes and arrows, never inside code (Sanity's guard).
const typographyGuard = createDecoratorGuard({decorators: ({context}) => context.schema.decorators.flatMap((d) => (d.name === 'code' ? [] : [d.name]))})

/**
 * The plugins Sanity's Portable Text input runs by default (its PortableTextEditorPlugins):
 * Markdown shortcuts for what the field declares, a URL pasted over text links it, and
 * smart typography.
 */
function SanityPlugins({field, stored}: {field: Field; stored: PtBlock[]}) {
  const md = useMemo(() => markdownNames(field), [field])
  const links = useMemo(() => pastesLinks(field, stored), [field, stored])
  // Sanity's own matcher: the schema's `link` with a string `href`.
  const link = useMemo<LinkMatcher>(
    () =>
      ({context, value}) =>
        links && context.schema.annotations.find((a) => a.name === 'link')?.fields.some((f) => f.name === 'href' && f.type === 'string') ? {_type: 'link', href: value.href} : undefined,
    [links],
  )
  return (
    <>
      <MarkdownShortcutsPlugin
        boldDecorator={() => md.boldDecorator}
        codeDecorator={() => md.codeDecorator}
        italicDecorator={() => md.italicDecorator}
        strikeThroughDecorator={() => md.strikeThroughDecorator}
        defaultStyle={() => md.defaultStyle}
        blockquoteStyle={() => md.blockquoteStyle}
        headingStyle={({props}) => md.headingStyle(props.level)}
        orderedList={() => md.orderedList}
        unorderedList={() => md.unorderedList}
      />
      <PasteLinkPlugin link={link} />
      <TypographyPlugin guard={typographyGuard} />
    </>
  )
}

/** Saves an edit as the merged value; nothing at all when the merge equals what is stored. */
function Saver({stored, onChange, onInvalid, onReady, mine, focused, onBlur}: Shared & {stored: PtBlock[]; onChange: (v: unknown) => void; onInvalid: () => void; onReady: () => void}) {
  const editor = useEditor()
  const seen = useRef<PtBlock[] | null>(null)
  const last = useRef<unknown>(stored)
  const on = (event: EditorEmittedEvent) => {
    if (event.type === 'focused') focused.current = true
    if (event.type === 'blurred') (focused.current = false), onBlur()
    if (event.type === 'invalid value') return onInvalid()
    // The editor's own reading of the stored value, before any edit: what an untouched block looks like.
    if (event.type === 'ready') (seen.current = (editor.getSnapshot().context.value ?? []) as PtBlock[]), onReady()
    if (event.type !== 'mutation') return
    seen.current ??= stored
    const merged = mergeValue(stored, seen.current, (event.value ?? []) as PtBlock[])
    const next = merged.length ? merged : undefined
    if (equal(next ?? [], last.current ?? [])) return
    last.current = next
    mine.current = [...mine.current.slice(-19), next ?? []]
    onChange(next)
  }
  return <EventListenerPlugin on={on} />
}

type ToolbarProps = {id: string; field: Field; stored: PtBlock[]; schemas: SchemaLike[]; openRef: OpenRef; ready: boolean}

function Toolbar({id, field, stored, schemas, openRef, ready}: ToolbarProps) {
  const t = useT()
  const editor = useEditor()
  const vocab = useMemo(() => declaredVocabulary(field), [field])
  const annotations = useMemo(() => offeredAnnotations(field, stored), [field, stored])
  const style = useEditorSelector(editor, getActiveStyle)
  const styles = vocab.styles
  return (
    <fieldset className="body-toolbar pt-toolbar" role="toolbar" aria-label={t('Formatting')} disabled={!ready} onMouseDown={(e) => e.currentTarget.contains(e.target as Node) && (e.target as HTMLElement).tagName !== 'SELECT' && e.preventDefault()}>
      {styles.length > 1 && (
        <select
          className="input pt-style"
          aria-label={t('Block style')}
          value={style ?? ''}
          onChange={(e) => {
            editor.send({type: 'style.toggle', style: e.target.value})
            editor.send({type: 'focus'})
          }}
        >
          {!style && <option value="">{t('No style')}</option>}
          {styles.map((s) => (
            <option key={s.name} value={s.name}>
              {s.title ?? t(STYLE_LABEL[s.name] ?? s.name)}
            </option>
          ))}
        </select>
      )}
      {vocab.decorators.map((d) => (
        <MarkButton key={d.name} name={d.name} label={d.title ?? (MARKS[d.name] ? t(MARKS[d.name][0]) : d.name)} icon={MARKS[d.name]?.[1]} />
      ))}
      {vocab.lists.length > 0 && <span className="body-toolbar-sep" />}
      {vocab.lists.map((l) => (
        <ListButton key={l.name} name={l.name} label={l.title ?? (LISTS[l.name] ? t(LISTS[l.name][0]) : l.name)} icon={LISTS[l.name]?.[1]} />
      ))}
      {annotations.length > 0 && <span className="body-toolbar-sep" />}
      {annotations.map((a) => (
        <AnnotationButton key={a.name} id={id} name={a.name} field={field} stored={stored} schemas={schemas} openRef={openRef} />
      ))}
      <InsertMenu field={field} schemas={schemas} />
    </fieldset>
  )
}

/**
 * Insert: the declared custom block and inline object types. A pick puts a new one in, a
 * custom block after the caret's block and an inline object at the caret, with its `_type`
 * and a new 12-hex `_key`, and opens it to fill in, as Sanity's does. An inline object
 * needs the caret in text.
 */
function InsertMenu({field, schemas}: {field: Field; schemas: SchemaLike[]}) {
  const t = useT()
  const editor = useEditor()
  const edit = useContext(EditObject)
  const inText = !!useEditorSelector(editor, getFocusTextBlock)
  const [open, setOpen] = useState(false)
  const {blocks, inline} = useMemo(() => insertable(field), [field])
  if (!blocks.length && !inline.length) return null
  const insert = (kind: ObjectKind, name: string) => {
    setOpen(false)
    const _key = newKey()
    // After the caret's block, never splitting its text.
    if (kind === 'block') editor.send({type: 'insert.block', block: {_type: name, _key}, placement: 'after', select: 'none'})
    else editor.send({type: 'insert.child', child: {_type: name, _key}})
    // Where it landed: by its key.
    for (const b of (editor.getSnapshot().context.value ?? []) as PtBlock[]) {
      if (kind === 'block' && b._key === _key) return edit?.({kind, node: b as Obj, path: [{_key}]})
      const child = kind === 'inline' && Array.isArray(b.children) ? (b.children as Obj[]).find((c) => c._key === _key) : undefined
      if (child) return edit?.({kind, node: child, path: [{_key: b._key}, 'children', {_key}]})
    }
  }
  const title = (kind: ObjectKind, n: {name: string; title?: string}) => n.title ?? objectTitle(field, kind, n.name, schemas)
  return (
    <>
      <span className="body-toolbar-sep" />
      {/* The button takes focus, as the canvas toolbar's style button does, so the menu can return it there; the editor keeps its selection. */}
      <div className="menu-wrap pt-insert-wrap" onMouseDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
        <button type="button" className="icon-btn body-tool" aria-label={t('Insert')} data-tip={t('Insert')} data-tip-side="top" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Add />
        </button>
        {open && (
          <MenuPopover onClose={() => setOpen(false)}>
            {blocks.map((b) => (
              <button key={`b:${b.name}`} type="button" role="menuitem" className="menu-item" data-insert={b.name} onClick={() => insert('block', b.name)}>
                {title('block', b)}
              </button>
            ))}
            {blocks.length > 0 && inline.length > 0 && <hr />}
            {inline.map((i) => (
              <button key={`i:${i.name}`} type="button" role="menuitem" className="menu-item" data-insert={i.name} disabled={!inText} onClick={() => insert('inline', i.name)}>
                {title('inline', i)}
              </button>
            ))}
          </MenuPopover>
        )}
      </div>
    </>
  )
}

/** A custom block's or inline object's fields: what changed sets on it, an emptied field goes. */
function ObjectDialog({id, edit, field, stored, schemas, openRef, onClose}: {id: string; edit: ObjectEdit; field: Field; stored: PtBlock[]; schemas: SchemaLike[]; openRef: OpenRef; onClose: () => void}) {
  const editor = useEditor()
  const {kind, node, path} = edit
  const fields = useMemo(() => objectFields(field, kind, node._type, stored, schemas), [field, kind, node._type, stored, schemas])
  const title = objectTitle(field, kind, node._type, schemas)
  const request: BlockObjectRequest = {type: node._type, title, inline: kind === 'inline', fields, value: node as unknown as BlockObjectRequest['value'], error: null}
  const done = (value: Record<string, unknown> | null) => {
    onClose()
    if (value) {
      const {set, unset} = objectChanges(node, storedShape(fields, value, node))
      const at = path as never
      if (Object.keys(set).length) editor.send(kind === 'block' ? {type: 'block.set', at, props: set} : {type: 'child.set', at, props: set})
      if (unset.length) editor.send(kind === 'block' ? {type: 'block.unset', at, props: unset} : {type: 'child.unset', at, props: unset})
    }
    editor.send({type: 'focus'})
  }
  return <BlockObjectDialog key={JSON.stringify(path)} request={request} path={`${id}.${node._type}`} openRef={openRef} onDone={done} />
}

type Selection = NonNullable<ReturnType<ReturnType<typeof useEditor>['getSnapshot']>['context']['selection']>
type Markdef = Record<string, unknown> & {_key: string; _type: string}
type AnnotationEdit = {request: BlockObjectRequest; at: Selection; def?: Markdef; blockPath?: unknown[]; markDefs?: Markdef[]}

/**
 * One annotation type's button. With text selected it adds one: a dialog of its fields,
 * and the annotation goes on when the dialog closes with something filled in. With the
 * caret in one it opens that one: what is changed there sets that markDef only, and
 * Remove takes the annotation off its text.
 */
function AnnotationButton({id, name, field, stored, schemas, openRef}: {id: string; name: string; field: Field; stored: PtBlock[]; schemas: SchemaLike[]; openRef: OpenRef}) {
  const t = useT()
  const editor = useEditor()
  const active = useEditorSelector(editor, isActiveAnnotation(name))
  const expanded = useEditorSelector(editor, isSelectionExpanded)
  const [edit, setEdit] = useState<AnnotationEdit | null>(null)
  const title = objectTitle(field, 'annotation', name)
  const label = active ? t('Edit {name}', {name: title}) : title
  const open = () => {
    const snap = editor.getSnapshot()
    const at = snap.context.selection
    if (!at) return
    const fields = objectFields(field, 'annotation', name, stored, schemas)
    const base = {type: name, title, inline: true, fields, error: null}
    if (active) {
      const def = getActiveAnnotations(snap).find((a) => a._type === name) as Markdef | undefined
      const block = getFocusTextBlock(snap)
      if (!def || !block) return
      setEdit({request: {...base, value: def as unknown as BlockObjectRequest['value']}, at, def, blockPath: block.path, markDefs: (block.node.markDefs ?? []) as Markdef[]})
    } else if (expanded) setEdit({request: {...base, value: {_type: name} as unknown as BlockObjectRequest['value']}, at})
  }
  const done = (value: Record<string, unknown> | null) => {
    const e = edit
    setEdit(null)
    if (!e || !value) return editor.send({type: 'focus'})
    const shaped = storedShape(e.request.fields, value, e.def ?? {})
    if (e.def && e.blockPath && e.markDefs) {
      // This markDef only, whole: a field emptied in the dialog goes from it.
      const markDefs = e.markDefs.map((d) => (d._key === e.def!._key ? {...shaped, _key: d._key, _type: d._type} : d))
      editor.send({type: 'block.set', at: e.blockPath as never, props: {markDefs}})
    } else {
      const {_key: _k, _type: _t, ...fields} = shaped
      editor.send({type: 'annotation.add', annotation: {name, _key: newKey(), value: fields}, at: e.at})
    }
    editor.send({type: 'focus'})
  }
  const openers = useContext(AnnotationOpeners)
  useEffect(() => {
    openers?.set(name, open)
    return () => void openers?.delete(name)
  })
  const remove = () => {
    const e = edit
    setEdit(null)
    if (!e) return
    // A caret (not a range) takes the whole annotation off, as far as its text runs.
    editor.send({type: 'annotation.remove', annotation: {name}, at: {anchor: e.at.focus, focus: e.at.focus}})
    editor.send({type: 'focus'})
  }
  return (
    <>
      <button type="button" className="icon-btn body-tool" aria-label={label} data-tip={label} data-tip-side="top" aria-pressed={active} data-annotation={name} disabled={!active && !expanded} onClick={open}>
        {/link/i.test(name) ? <LinkIcon /> : <span className="pt-tool-text">{title}</span>}
      </button>
      {edit && (
        <BlockObjectDialog
          key={JSON.stringify(edit.request.value)}
          request={edit.request}
          path={`${id}.${name}`}
          openRef={openRef}
          onDone={done}
          onRemove={edit.def ? remove : undefined}
          removeLabel={t('Remove {name}', {name: title})}
        />
      )}
    </>
  )
}

/**
 * Sanity's popover over an annotation: with the caret in one (and the editor focused), its
 * title, Edit (the toolbar button's dialog) and Remove, centred 4 px above its text.
 */
function AnnotationPopover({field}: {field: Field}) {
  const t = useT()
  const editor = useEditor()
  const openers = useContext(AnnotationOpeners)
  const active = useEditorSelector(editor, getActiveAnnotations)
  const collapsed = useEditorSelector(editor, isSelectionCollapsed)
  const [focused, setFocused] = useState(false)
  const [at, setAt] = useState<{left: number; top: number} | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const names = [...new Set(active.map((a) => a._type))]
  const show = focused && collapsed && names.length > 0
  useLayoutEffect(() => {
    const box = ref.current?.closest('.pt-input')
    const scroller = box?.querySelector('.pt-editable')
    if (!show || !box || !scroller) return setAt(null)
    // Over the annotation the caret is in, as the browser's selection has it.
    const place = () => {
      const node = getSelection()?.focusNode
      const mark = (node instanceof Element ? node : node?.parentElement)?.closest('.pt-annotation')
      if (!mark || !scroller.contains(mark)) return setAt(null)
      const r = mark.getBoundingClientRect()
      const view = scroller.getBoundingClientRect()
      const outer = box.getBoundingClientRect()
      setAt(r.bottom < view.top || r.top > view.bottom ? null : {left: r.left + r.width / 2 - outer.left, top: r.top - outer.top - 4})
    }
    place()
    scroller.addEventListener('scroll', place)
    return () => scroller.removeEventListener('scroll', place)
  }, [show, active])
  const remove = (name: string) => {
    const sel = editor.getSnapshot().context.selection
    // A caret takes the whole annotation off, as far as its text runs.
    if (sel) editor.send({type: 'annotation.remove', annotation: {name}, at: {anchor: sel.focus, focus: sel.focus}})
    editor.send({type: 'focus'})
  }
  return (
    <>
      <EventListenerPlugin on={(e) => (e.type === 'focused' ? setFocused(true) : e.type === 'blurred' && setFocused(false))} />
      <span ref={ref} hidden />
      {show && at && (
        // Its buttons keep the editor's focus (and so the popover) while clicked.
        <div className="pt-annotation-pop" style={{left: at.left, top: at.top}} onMouseDown={(e) => e.preventDefault()}>
          {names.map((name) => (
            <span key={name} className="pt-annotation-pop-row">
              <span className="pt-annotation-pop-title">{objectTitle(field, 'annotation', name)}</span>
              {openers?.has(name) && (
                <button type="button" className="icon-btn" aria-label={t('Edit annotation')} data-tip={t('Edit annotation')} data-tip-side="top" onClick={() => openers.get(name)?.()}>
                  <EditIcon />
                </button>
              )}
              <button type="button" className="icon-btn" aria-label={t('Remove annotation')} data-tip={t('Remove annotation')} data-tip-side="top" onClick={() => remove(name)}>
                <Trash />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function MarkButton({name, label, icon: Icon}: {name: string; label: string; icon?: () => ReactNode}) {
  const editor = useEditor()
  const active = useEditorSelector(editor, isActiveDecorator(name))
  return (
    <button type="button" className="icon-btn body-tool" aria-label={label} data-tip={label} data-tip-side="top" aria-pressed={active} onClick={() => (editor.send({type: 'decorator.toggle', decorator: name}), editor.send({type: 'focus'}))}>
      {Icon ? <Icon /> : <span className="pt-tool-text">{label}</span>}
    </button>
  )
}

function ListButton({name, label, icon: Icon}: {name: string; label: string; icon?: () => ReactNode}) {
  const editor = useEditor()
  const active = useEditorSelector(editor, isActiveListItem(name))
  return (
    <button type="button" className="icon-btn body-tool" aria-label={label} data-tip={label} data-tip-side="top" aria-pressed={active} onClick={() => (editor.send({type: 'list item.toggle', listItem: name}), editor.send({type: 'focus'}))}>
      {Icon ? <Icon /> : <span className="pt-tool-text">{label}</span>}
    </button>
  )
}
