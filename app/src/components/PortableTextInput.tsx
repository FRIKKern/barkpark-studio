import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
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
import {getActiveAnnotations, getActiveStyle, getFocusTextBlock, isActiveAnnotation, isActiveDecorator, isActiveListItem, isSelectionExpanded} from '@portabletext/editor/selectors'
import {useQuery} from '@tanstack/react-query'
import {schemasQuery, type Field} from '../lib/data'
import {useT} from '../lib/i18n'
import {declaredVocabulary, editorSchema, equal, mergeValue, newKey, objectFields, objectTitle, offeredAnnotations, storedShape, type PtBlock, type PtSchema, type SchemaLike} from '../lib/pt-value'
import {BlockObjectDialog, type BlockObjectRequest} from './BlockObjectDialog'
import type {OpenRef} from './Fields'
import {BoldIcon, CodeIcon, ItalicIcon, LinkIcon, OlistIcon, StrikeIcon, UlistIcon, UnderlineIcon} from './icons'

// S4a (task-7f77f41c95cc6d9f): a richText field holding Portable Text, edited with
// @portabletext/editor (owner decision D2). Text, styles, lists and decorators edit.
// S4b: annotations add, edit and go, in a dialog of the annotation's fields (lib/pt-value.ts
// says where they come from); a reference field is the studio's reference input. Custom
// blocks and inline objects (S4c) show and are kept as stored.
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

/** Custom blocks and inline objects: drawn by type name, kept as stored (S4c edits them). */
function objectNodes(schema: PtSchema): RegistrableNode[] {
  const title = (name: string, list: {name: string; title?: string}[]) => list.find((n) => n.name === name)?.title ?? name
  return [
    ...schema.blockObjects.map((o) =>
      defineBlockObject({
        type: o.name as 'x',
        render: ({attributes, children}) => (
          <div {...attributes} className="pt-object" data-type={o.name}>
            {children}
            <span className="pt-object-label" contentEditable={false}>
              {title(o.name, schema.blockObjects)}
            </span>
          </div>
        ),
      }),
    ),
    ...schema.inlineObjects.map((o) =>
      defineInlineObject({
        type: o.name as 'x',
        render: ({attributes, children}) => (
          <span {...attributes} className="pt-inline-object" data-type={o.name}>
            {children}
            <span contentEditable={false}>{title(o.name, schema.inlineObjects)}</span>
          </span>
        ),
      }),
    ),
  ]
}

type Props = {id: string; field: Field; value: PtBlock[] | undefined; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}

export default function PortableTextInput(props: Props) {
  // A value from elsewhere (another editor, a restore) remounts the editor on it; this
  // input's own saves coming back do not. `mine` is what this input has sent.
  const mine = useRef<unknown[]>([])
  const [base, setBase] = useState(() => ({value: props.value ?? [], n: 0}))
  const focused = useRef(false)
  // A blur looks again at a value that came in while the author was typing.
  const [blurs, setBlurs] = useState(0)
  const incoming = props.value ?? []
  useEffect(() => {
    if (equal(incoming, base.value) || mine.current.some((v) => equal(v, incoming))) return
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
  const nodes = useMemo(() => [textBlock, decorators, annotations, ...objectNodes(schema)], [schema])
  // A value the editor can't read: it stays read-only and nothing is saved from it.
  const [invalid, setInvalid] = useState(false)
  // The toolbar waits for the editor to have read the value (its 'ready').
  const [ready, setReady] = useState(false)
  const locked = readOnly || invalid
  return (
    <div className="pt-input" data-readonly={locked || undefined} data-ready={ready || undefined}>
      <EditorProvider initialConfig={{schemaDefinition: schema, initialValue: stored as PortableTextBlock[], readOnly: locked}}>
        <NodePlugin nodes={nodes} />
        <Saver stored={stored} onChange={invalid ? () => {} : onChange} onInvalid={() => setInvalid(true)} onReady={() => setReady(true)} mine={mine} focused={focused} onBlur={onBlur} />
        {invalid && (
          <p className="pt-note" role="status">
            {t('This text holds content the editor cannot read. It is shown read-only and kept as it is.')}
          </p>
        )}
        {!locked && <Toolbar id={id} field={field} stored={stored} schemas={schemas} openRef={openRef} ready={ready} />}
        <PortableTextEditable id={id} className="pt-editable" aria-labelledby={`${id}-label`} />
      </EditorProvider>
    </div>
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
    </fieldset>
  )
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
