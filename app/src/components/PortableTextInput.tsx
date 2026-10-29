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
  type RangeDecoration,
  type RegistrableNode,
} from '@portabletext/editor'
import {EventListenerPlugin, NodePlugin} from '@portabletext/editor/plugins'
import {MarkdownShortcutsPlugin} from '@portabletext/plugin-markdown-shortcuts'
import {PasteLinkPlugin, type LinkMatcher} from '@portabletext/plugin-paste-link'
import {createDecoratorGuard, TypographyPlugin} from '@portabletext/plugin-typography'
import {getActiveAnnotations, getActiveStyle, getFocusTextBlock, isActiveAnnotation, isActiveDecorator, isActiveListItem, isSelectionCollapsed, isSelectionExpanded} from '@portabletext/editor/selectors'
import {useQuery} from '@tanstack/react-query'
import {schemasQuery, type Field} from '../lib/data'
import {imageRef, imageSrc} from '../lib/image'
import {keyedPath} from '../lib/paths'
import {uploadFile, uploadReason} from '../lib/upload'
import {toast} from './Toasts'
import {useFileInfo} from './FileInput'
import {useT} from '../lib/i18n'
import {asEditorHolds, caretOf, changedBlocks, remoteCarets, remoteBlockPatches, spanText, textPatches, withRemote, type RemotePatch, declaredVocabulary, editorSchema, equal, insertable, isOutsideValue, markdownNames, mergeValue, newKey, objectChanges, objectFields, objectTitle, offeredAnnotations, pastesLinks, storedShape, type PtBlock, type PtSchema, type SchemaLike} from '../lib/pt-value'
import {parsePatch} from '@sanity/diff-match-patch'
import {applyText} from '../lib/merge'
import {BlockObjectDialog, type BlockObjectRequest} from './BlockObjectDialog'
import {EditPathContext, ExpandButton, useExpandArea, type OpenRef} from './Fields'
import {DocIdContext} from './doc-ids'
import {onKeyedMiss} from '../lib/edits'
import {reportSelection, usePresences} from '../lib/presence'
import {usePersonNamer} from '../lib/person'
import {MenuPopover} from './FocusScopes'
import {BlockIcon, BoldIcon, ChevronDown, CodeIcon, EditIcon, Ellipsis, InlineIcon, ItalicIcon, LinkIcon, OlistIcon, StrikeIcon, Trash, UlistIcon, UnderlineIcon} from './icons'

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

/**
 * A custom block: its type's title, a line of its text, and Sanity's "Open menu" (…) with
 * Edit and Remove. A double click edits it too.
 */
function BlockCard({node, path, title, readOnly, attributes, children}: {node: Obj; path: unknown[]; title: string; readOnly: boolean; attributes: Record<string, unknown>; children: ReactNode}) {
  const t = useT()
  const editor = useEditor()
  const edit = useContext(EditObject)
  const [menu, setMenu] = useState(false)
  const open = () => !readOnly && edit?.({kind: 'block', node, path})
  const line = preview(node)
  // An image block shows its file's name over the image itself, across the card, as Sanity's.
  const image = node._type === 'image' ? imageRef(node) : undefined
  const {data: file} = useFileInfo(image)
  const remove = () => {
    setMenu(false)
    editor.send({type: 'delete.block', at: path as never})
    editor.send({type: 'focus'})
  }
  return (
    <div {...attributes} className="pt-object" data-type={node._type} onDoubleClick={open}>
      {children}
      {/* Draggable, as the editor's own block object (and Sanity's card): drop it between blocks to move it. */}
      <span className="pt-object-head" contentEditable={false} draggable={!readOnly}>
        <span className="pt-object-label">{image ? (file?.name ?? title) : title}</span>
        {line && <span className="pt-object-preview">{line}</span>}
        {!readOnly && edit && (
          // The editor never sees the menu's pointer and keys (it would select the block and take the focus back).
          <span
            className="menu-wrap pt-object-menu"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}
          >
            <button type="button" className="icon-btn pt-object-more" aria-label={t('Open menu')} data-tip={t('Show more')} data-tip-side="top" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Ellipsis />
            </button>
            {menu && (
              <MenuPopover className="popover menu pt-object-actions" onClose={() => setMenu(false)}>
                <button type="button" role="menuitem" className="menu-item" autoFocus onClick={() => (setMenu(false), open())}>
                  <span className="menu-icon-text">
                    <EditIcon /> {t('Edit')}
                  </span>
                </button>
                <button type="button" role="menuitem" className="menu-item danger" onClick={remove}>
                  <span className="menu-icon-text">
                    <Trash /> {t('Remove')}
                  </span>
                </button>
              </MenuPopover>
            )}
          </span>
        )}
      </span>
      {image && (
        <span className="pt-image-view" contentEditable={false} draggable={!readOnly}>
          <img src={imageSrc(image, 1200, 750)} alt="" decoding="async" />
        </span>
      )}
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

function Editor({id, field, value, stored, schemas, onChange, readOnly, openRef, mine, focused, onBlur}: Props & Shared & {stored: PtBlock[]; schemas: SchemaLike[]}) {
  const t = useT()
  const schema = useMemo(() => editorSchema(field, stored, schemas), [field, stored, schemas])
  const nodes = useMemo(() => [textBlock, decorators, annotations, ...objectNodes(schema, (kind, name) => objectTitle(field, kind, name, schemas))], [schema, field, schemas])
  const [objectEdit, setObjectEdit] = useState<ObjectEdit | null>(null)
  // A value the editor can't read: it stays read-only and nothing is saved from it.
  const [invalid, setInvalid] = useState(false)
  // The toolbar waits for the editor to have read the value (its 'ready').
  const [ready, setReady] = useState(false)
  const locked = readOnly || invalid
  // Writes one path of the doc (lib/edits.ts): none in a dialog, where the whole value goes back.
  const editPath = useContext(EditPathContext)
  const openers = useMemo(() => new Map<string, () => void>(), [])
  // Expanded over the document pane and back, as the canvas body (J35): the same editor
  // stays mounted (only its frame moves), so caret, selection and edits are kept.
  const box = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const area = useExpandArea(box, expanded)
  const toggle = () => {
    setExpanded((x) => !x)
    requestAnimationFrame(() => getSelection()?.focusNode?.parentElement?.scrollIntoView({block: 'nearest'}))
  }
  return (
    <div
      className="pt-input"
      ref={box}
      data-readonly={locked || undefined}
      data-ready={ready || undefined}
      data-expanded={expanded || undefined}
      style={expanded ? area : undefined}
      // Cmd/Ctrl+Enter toggles, as Sanity's; Escape in the text collapses. Not from a dialog
      // (its keys come through React's tree too) and not over an open menu.
      onKeyDownCapture={(e) => {
        const inText = (e.target as HTMLElement).closest?.('.pt-editable') && box.current?.contains(e.target as Node)
        if (locked || !inText) return
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey) return e.preventDefault(), e.stopPropagation(), toggle()
        if (expanded && e.key === 'Escape' && !box.current?.querySelector('[role="menu"]')) e.preventDefault(), e.stopPropagation(), toggle()
      }}
    >
      <EditorProvider initialConfig={{schemaDefinition: schema, initialValue: stored as PortableTextBlock[], readOnly: locked}}>
        <NodePlugin nodes={nodes} />
        {!locked && <SanityPlugins field={field} stored={stored} />}
        <Saver id={id} stored={stored} incoming={value} onChange={invalid ? () => {} : onChange} editPath={invalid ? null : editPath} onInvalid={() => setInvalid(true)} onReady={() => setReady(true)} mine={mine} focused={focused} onBlur={onBlur} />
        {invalid && (
          <p className="pt-note" role="status">
            {t('This text holds content the editor cannot read. It is shown read-only and kept as it is.')}
          </p>
        )}
        <EditObject.Provider value={locked ? null : setObjectEdit}>
          <AnnotationOpeners.Provider value={openers}>
            {!locked && <Toolbar id={id} field={field} stored={stored} schemas={schemas} openRef={openRef} ready={ready} />}
            <Editable id={id} />
            {!locked && <AnnotationPopover field={field} />}
            {!locked && <ImagePaste field={field} />}
          </AnnotationOpeners.Provider>
        </EditObject.Provider>
        {!locked && <ExpandButton expanded={expanded} aria-pressed={expanded} className="icon-btn body-expand pt-expand" onMouseDown={(e) => e.preventDefault()} onClick={toggle} />}
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

/** How long after this editor's last keystroke another editor's text waits (a word's letters come faster). */
const WORD_PAUSE_MS = 500

/**
 * The text, with the other editors' carets in it where they are, as Sanity's: a line in their
 * presence colour with a dot on top (their name on hover), their selection tinted. From their
 * presence in this field, so a caret goes when its editor leaves the field.
 */
function Editable({id}: {id: string}) {
  const docId = useContext(DocIdContext)
  const nameOf = usePersonNamer()
  const value = useEditorSelector(useEditor(), (s) => s.context.value)
  const here = usePresences().filter((p) => p.documentId === docId && p.field === id && p.selection)
  const key = JSON.stringify(here.map((p) => [p.sessionId, p.color, p.name, p.selection]))
  const decorations = useMemo(
    () =>
      remoteCarets(value, here).map(({person, kind, selection}): RangeDecoration => {
        const name = nameOf(person.name) ?? person.name
        const style = {'--who': person.color} as React.CSSProperties
        return {
          selection,
          payload: {id: `${person.sessionId}:${kind}`},
          component:
            kind === 'caret'
              ? ({children}) => (
                  <>
                    {children}
                    <span contentEditable={false} className="pt-remote-caret" style={style} data-testid={`presence-cursor-${name}`} title={name}>
                      <span className="pt-remote-caret__dot" />
                    </span>
                  </>
                )
              : ({children}) => (
                  <span className="pt-remote-selection" style={style}>
                    {children}
                  </span>
                ),
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the people, by value
    [key, value, nameOf],
  )
  return <PortableTextEditable id={id} className="pt-editable" aria-labelledby={`${id}-label`} rangeDecorations={decorations} />
}

/** Saves an edit as the merged value; nothing at all when the merge equals what is stored. */
function Saver({id, stored, incoming, onChange, editPath, onInvalid, onReady, mine, focused, onBlur}: Shared & {id: string; stored: PtBlock[]; incoming: unknown; onChange: (v: unknown) => void; editPath: ((path: string, value: unknown) => void) | null; onInvalid: () => void; onReady: () => void}) {
  const editor = useEditor()
  const docId = useContext(DocIdContext)
  const seen = useRef<PtBlock[] | null>(null)
  const last = useRef<unknown>(stored)
  // The editor's own value at its previous change: a block is this editor's edit when it
  // differs from that, not from the last save (another editor's block it has not drawn yet,
  // its patch deferred while this one types, would read as an edit and go back stale).
  const before = useRef<unknown>(stored)
  // Each block's versions as the server sent them (`incoming`), and when this editor last
  // sent each block: a block that reads as one the server sent since this editor last sent it
  // is theirs (drawn, or not drawn yet), never sent back as this editor's edit.
  const seq = useRef(0)
  const sentAt = useRef(new Map<string, number>())
  const sentWhen = useRef(new Map<string, number>())
  const fromServer = useRef(new Map<string, {block: unknown; at: number}[]>())
  // The editor's value as the server last sent it, and each span's text (`block/span`) as
  // this editor has accounted for it since: its own typing applied, and others' given to it.
  // Text that comes in different from that is another editor's (remoteBlockPatches). The
  // texts its own typing wrote in the last 10 s: an older echo of those is never theirs.
  const known = useRef<unknown>(stored)
  const text = useRef(new Map<string, string>())
  const wrote = useRef<{at: string; text: string; when: number}[]>([])
  const remember = (blocks: unknown[]) => {
    for (const b of blocks as PtBlock[]) for (const c of Array.isArray(b?.children) ? (b.children as {_key?: string; text?: unknown}[]) : []) if (typeof c.text === 'string') text.current.set(`${b._key}/${c._key}`, c.text)
  }
  const theirs = (key: string, block: unknown) =>
    (fromServer.current.get(key) ?? []).some((r) => r.at > (sentAt.current.get(key) ?? 0) && equal(asEditorHolds(r.block), asEditorHolds(block)))
  const on = (event: EditorEmittedEvent) => {
    if (event.type === 'focused') focused.current = true
    if (event.type === 'blurred') (focused.current = false), onBlur(), docId && reportSelection(docId, null)
    // D11: this editor's caret goes out with its presence, for the others' text.
    if (event.type === 'selection' && focused.current && docId) reportSelection(docId, caretOf(event.selection))
    if (event.type === 'invalid value') return onInvalid()
    // The editor's own reading of the stored value, before any edit: what an untouched block looks like.
    if (event.type === 'ready') (seen.current = (editor.getSnapshot().context.value ?? []) as PtBlock[]), onReady()
    if (event.type === 'patch') typing.current = Date.now() // each keystroke as it lands; `mutation` comes batched
    if (event.type !== 'mutation') return
    seen.current ??= stored
    const merged = mergeValue(stored, seen.current, (event.value ?? []) as PtBlock[])
    const next = merged.length ? merged : undefined
    const prior = before.current
    before.current = next
    // Typing alone: its diff-match-patch goes onto each span as stored now, so another
    // editor's words in that span stay (two editors in one block, as Sanity's).
    const typed = editPath && textPatches(event.patches)
    if (typed) {
      last.current = next
      mine.current = [...mine.current.slice(-19), next ?? []]
      for (const t of typed) {
        const at = `${t.block}/${t.span}`
        const own = parsePatch(t.value)
        const from = text.current.get(at) ?? spanText(known.current, t.block, t.span)
        text.current.set(at, applyText(own, from))
        wrote.current = [...wrote.current.filter((w) => Date.now() - w.when < 10_000), {at, text: text.current.get(at)!, when: Date.now()}]
        sentAt.current.set(t.block, ++seq.current)
        sentWhen.current.set(t.block, Date.now())
        editPath(`${keyedPath(keyedPath(id, t.block) + '.children', t.span)}.text`, (now: unknown) => applyText(own, typeof now === 'string' ? now : ''))
      }
      return
    }
    if (equal(next ?? [], last.current ?? [])) return
    // Blocks edited in place go as `field[_key=="…"]` sets, those blocks only (a 300-block
    // body sent 337 KB a keystroke whole); a block that came, went or moved sends the field.
    const parts = editPath && next ? changedBlocks(prior, next)?.filter((p) => !theirs(p.key, p.block)) ?? null : null
    last.current = next
    mine.current = [...mine.current.slice(-19), next ?? []]
    if (parts && parts.length * 2 <= next!.length)
      for (const p of parts) {
        sentAt.current.set(p.key, ++seq.current)
        sentWhen.current.set(p.key, Date.now())
        editPath!(keyedPath(id, p.key), p.block)
        remember([p.block])
      }
    else onChange(next), remember(next ?? [])
  }
  const typing = useRef(0)
  const held = useRef<RemotePatch[]>([])
  const flushText = useRef(() => {})
  flushText.current = () => {
    clearTimeout(flushTimer.current)
    const wait = typing.current + WORD_PAUSE_MS - Date.now()
    if (wait > 0) flushTimer.current = setTimeout(() => flushText.current(), wait)
    else if (held.current.length) editor.send({type: 'patches', patches: held.current.splice(0) as never, snapshot: known.current as never})
  }
  const flushTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(flushTimer.current), [])
  // A block saved by its key that another editor removed meanwhile (the key found no item):
  // the whole field again, as this editor has it, so no keystroke in it is lost.
  const resend = useRef(() => {})
  resend.current = () => {
    mine.current = [...mine.current.slice(-19), last.current ?? []]
    onChange(last.current)
  }
  useEffect(() => (docId && editPath ? onKeyedMiss(docId, id, () => resend.current()) : undefined), [docId, editPath, id])
  // Another editor's blocks while this one has the focus (without it the input remounts on
  // them): patches the editor merges in, caret and typing kept, as Sanity's live edits.
  // A block this editor is typing in keeps its own version (remoteBlockPatches).
  useEffect(() => {
    const prev = known.current
    known.current = incoming
    for (const b of Array.isArray(incoming) ? (incoming as PtBlock[]) : [])
      if (typeof b?._key === 'string') fromServer.current.set(b._key, [...(fromServer.current.get(b._key) ?? []).slice(-7), {block: b, at: ++seq.current}])
    if (!focused.current || equal(prev ?? [], incoming ?? []) || mine.current.some((v) => equal(v, incoming ?? []))) return
    // Sent in the last 10 s: maybe not landed yet, kept (a removal then answers that save).
    const recent = new Set([...sentWhen.current].filter(([, at]) => Date.now() - at < 10_000).map(([k]) => k))
    const echo = (at: string, t: string) => wrote.current.some((w) => w.at === at && w.text === t && Date.now() - w.when < 10_000)
    const patches = remoteBlockPatches(prev ?? [], incoming ?? [], editor.getSnapshot().context.value ?? [], mine.current, recent, text.current, echo)
    remember(patches.flatMap((p) => (p.type === 'set' ? [p.value] : p.type === 'insert' ? p.items : [])))
    if (!patches.length) return
    // Their text alone waits while this editor is typing a word: put in mid-word it splits
    // this editor's undo step there (the editor merges letters into one step only while each
    // lands right after the last). Anything else goes now, with what waited before it.
    held.current.push(...patches)
    if (patches.every((p) => p.type === 'diffMatchPatch')) flushText.current()
    else editor.send({type: 'patches', patches: held.current.splice(0) as never, snapshot: incoming as never})
    // The next save is measured from the last one with their blocks in: they are not sent back
    // as this editor's own, and its typing not emitted yet still goes.
    last.current = withRemote(last.current, patches)
  }, [incoming, editor, focused, mine, stored])
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
  // One Tab stop, as Sanity's toolbar (and the canvas body's): the arrows, Home and End move
  // between its enabled tools, and the tool last used keeps the stop.
  const bar = useRef<HTMLFieldSetElement>(null)
  const at = useRef(0)
  const tools = () => [...(bar.current?.querySelectorAll<HTMLButtonElement>('button.body-style, button.body-tool, button.body-insert') ?? [])].filter((b) => !b.disabled && !b.closest('[role="menu"]'))
  const roveTo = (list: HTMLButtonElement[], i: number) => {
    at.current = i
    list.forEach((b, j) => (b.tabIndex = j === i ? 0 : -1))
  }
  useEffect(() => {
    const list = tools()
    if (list.length) roveTo(list, Math.min(at.current, list.length - 1))
  })
  const rove = (e: React.KeyboardEvent) => {
    const list = tools()
    const i = list.indexOf(e.target as HTMLButtonElement)
    const next = i < 0 ? -1 : ({ArrowRight: (i + 1) % list.length, ArrowLeft: (i - 1 + list.length) % list.length, Home: 0, End: list.length - 1} as Record<string, number>)[e.key] ?? -1
    if (next < 0) return
    e.preventDefault()
    roveTo(list, next)
    list[next]!.focus()
  }
  const focused = (e: React.FocusEvent) => {
    const list = tools()
    const i = list.indexOf(e.target as HTMLButtonElement)
    if (i >= 0) roveTo(list, i)
  }
  return (
    <fieldset
      ref={bar}
      className="body-toolbar pt-toolbar"
      role="toolbar"
      aria-label={t('Formatting')}
      disabled={!ready}
      onMouseDown={(e) => e.currentTarget.contains(e.target as Node) && (e.target as HTMLElement).tagName !== 'SELECT' && e.preventDefault()}
      onKeyDown={rove}
      onFocus={focused}
    >
      {styles.length > 1 && <StyleMenu styles={styles} style={style} />}
      {styles.length > 1 && vocab.decorators.length > 0 && <span className="body-toolbar-sep" />}
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
 * The block style, as Sanity's (and the canvas body's): a button with the caret's style and
 * a menu drawing each style as it looks. The button takes focus (the editor keeps its
 * selection), so the menu returns focus to it; a pick puts the caret back in the text.
 */
function StyleMenu({styles, style}: {styles: {name: string; title?: string}[]; style: string | undefined}) {
  const t = useT()
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const label = (s: {name: string; title?: string}) => s.title ?? t(STYLE_LABEL[s.name] ?? s.name)
  const current = styles.find((s) => s.name === style)
  const pick = (name: string) => {
    setOpen(false)
    if (name !== style) editor.send({type: 'style.toggle', style: name})
    editor.send({type: 'focus'})
  }
  return (
    <div className="menu-wrap body-style-wrap" onMouseDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button type="button" className="body-style" aria-haspopup="menu" aria-expanded={open} data-tip={t('Block style')} data-tip-side="top" onClick={() => setOpen((o) => !o)}>
        <span>{current ? label(current) : t('No style')}</span>
        <ChevronDown />
      </button>
      {open && (
        <MenuPopover onClose={() => setOpen(false)} aria-label={t('Block style')}>
          {styles.map((s) => (
            <button key={s.name} type="button" role="menuitemradio" aria-checked={s.name === style} className={`menu-item body-style-${s.name}`} onClick={() => pick(s.name)}>
              {label(s)}
            </button>
          ))}
        </MenuPopover>
      )}
    </div>
  )
}

type Tool = {name: string; title?: string; kind: ObjectKind}

/**
 * Insert: a named button per declared custom block and inline object type, with its icon,
 * as Sanity's toolbar (and the canvas body's). A pick puts a new one in, a custom block
 * after the caret's block and an inline object at the caret, with its `_type` and a new
 * 12-hex `_key`, and opens it to fill in. An inline object needs the caret in text.
 */
function InsertMenu({field, schemas}: {field: Field; schemas: SchemaLike[]}) {
  const t = useT()
  const editor = useEditor()
  const edit = useContext(EditObject)
  const inText = !!useEditorSelector(editor, getFocusTextBlock)
  const [open, setOpen] = useState(false)
  const {blocks, inline} = useMemo(() => insertable(field), [field])
  const tools = useMemo<Tool[]>(() => [...blocks.map((b) => ({...b, kind: 'block' as const})), ...inline.map((i) => ({...i, kind: 'inline' as const}))], [blocks, inline])
  // Sanity's fold: the inserts that don't fit the bar's end go behind Show more. Widths are
  // read with everything shown and kept per insert (as the canvas body's toolbar).
  const group = useRef<HTMLDivElement>(null)
  const widths = useRef(new Map<string, number>())
  const [folded, setFolded] = useState(0)
  const keys = tools.map((x) => `${x.kind}:${x.name}`).join()
  useLayoutEffect(() => setFolded(0), [keys])
  useLayoutEffect(() => {
    const el = group.current
    if (!el) return
    const fit = () => {
      for (const b of el.querySelectorAll<HTMLElement>('[data-tool]')) widths.current.set(b.dataset.tool!, b.offsetWidth + 4)
      const width = (n: number) => tools.slice(0, n).reduce((sum, x) => sum + (widths.current.get(`${x.kind}:${x.name}`) ?? 80), 0) - 4
      let fits = tools.length
      while (fits > 0 && width(fits) + (fits < tools.length ? 4 + 25 : 0) > el.clientWidth) fits--
      setFolded((f) => (f === tools.length - fits ? f : tools.length - fits))
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    return () => watch.disconnect()
  }, [keys, folded, tools])
  if (!tools.length) return null
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
  const label = (x: Tool) => t(x.kind === 'block' ? 'Insert {typeName} (block)' : 'Insert {typeName} (inline)', {typeName: title(x.kind, x)})
  const shown = tools.slice(0, tools.length - folded)
  const rest = tools.slice(tools.length - folded)
  return (
    <>
      <span className="body-toolbar-sep" />
      <div ref={group} className="body-tool-group pt-insert-group">
        {shown.map((x) => (
          <button key={`${x.kind}:${x.name}`} type="button" className="body-insert" data-tool={`${x.kind}:${x.name}`} aria-label={label(x)} disabled={x.kind === 'inline' && !inText} onClick={() => insert(x.kind, x.name)}>
            {x.kind === 'block' ? <BlockIcon /> : <InlineIcon />}
            <span>{title(x.kind, x)}</span>
          </button>
        ))}
        {rest.length > 0 && (
          // The button takes focus, as the canvas toolbar's does, so the menu returns it there; the editor keeps its selection.
          <div className="menu-wrap body-more-wrap" onMouseDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
            <button type="button" className="icon-btn body-tool" aria-label={t('Show more')} data-tip={t('Show more')} data-tip-side="top" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <Ellipsis />
            </button>
            {open && (
              <MenuPopover centered onClose={() => setOpen(false)}>
                {rest.map((x) => (
                  <button key={`${x.kind}:${x.name}`} type="button" role="menuitem" className="menu-item body-more-item" disabled={x.kind === 'inline' && !inText} onClick={() => insert(x.kind, x.name)}>
                    {x.kind === 'block' ? <BlockIcon /> : <InlineIcon />}
                    <span>{title(x.kind, x)}</span>
                  </button>
                ))}
              </MenuPopover>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/** A custom block's or inline object's fields: what changed sets on it, an emptied field goes. */
function ObjectDialog({id, edit, field, stored, schemas, openRef, onClose}: {id: string; edit: ObjectEdit; field: Field; stored: PtBlock[]; schemas: SchemaLike[]; openRef: OpenRef; onClose: () => void}) {
  const editor = useEditor()
  const {kind, node, path} = edit
  const title = objectTitle(field, kind, node._type, schemas)
  // An image block: Sanity's image input on the block itself (upload, select, hotspot and crop).
  const image = kind === 'block' && node._type === 'image'
  const fields = useMemo(
    () => (image ? [{name: 'image', title, type: 'image', options: {hotspot: true}} as Field] : objectFields(field, kind, node._type, stored, schemas)),
    [image, title, field, kind, node._type, stored, schemas],
  )
  const {_key: _k, ...own} = node
  const request: BlockObjectRequest = {type: node._type, title, inline: kind === 'inline', fields, value: (image ? {type: 'image', image: own} : node) as unknown as BlockObjectRequest['value'], error: null}
  const done = (value: Record<string, unknown> | null) => {
    onClose()
    if (value) {
      const next = image ? {...(value.image as Obj | undefined), _key: node._key, _type: 'image'} : storedShape(fields, value, node)
      const {set, unset} = objectChanges(node, next)
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

/**
 * An image file pasted into the text, where the field takes image blocks, goes up and comes
 * back as an image block after the caret's block, as Sanity's does. A failed upload says so
 * and puts nothing in. Other pastes are the editor's.
 */
function ImagePaste({field}: {field: Field}) {
  const t = useT()
  const editor = useEditor()
  const ref = useRef<HTMLSpanElement>(null)
  const takes = useMemo(() => insertable(field).blocks.some((b) => b.name === 'image'), [field])
  useEffect(() => {
    const text = ref.current?.closest('.pt-input')?.querySelector<HTMLElement>('.pt-editable')
    if (!takes || !text) return
    const paste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      e.stopImmediatePropagation()
      // Where the caret was when pasted, whatever it does while the file goes up.
      const at = editor.getSnapshot().context.selection ?? undefined
      uploadFile(file, () => {}, new AbortController().signal).then(
        (assetRef) => editor.send({type: 'insert.block', block: {_type: 'image', _key: newKey(), asset: {_type: 'reference', _ref: assetRef}}, placement: 'after', select: 'none', ...(at && {at})}),
        (err) => toast({tone: 'critical', title: t('Upload failed'), description: uploadReason(err, t)}),
      )
    }
    text.addEventListener('paste', paste, true)
    return () => text.removeEventListener('paste', paste, true)
  }, [takes, editor, t])
  return <span ref={ref} hidden />
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
