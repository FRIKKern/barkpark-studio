import {useEffect, useRef, useState, type ReactNode, type RefObject} from 'react'
import {MenuPopover} from './FocusScopes'
import {BlockIcon, BoldIcon, ChevronDown, CodeIcon, ImageIcon, ItalicIcon, LinkIcon, OlistIcon, StrikeIcon, UlistIcon, UnderlineIcon} from './icons'
import {useT} from '../lib/i18n'
import {loadCanvas} from '../lib/canvas-bundle'

// J10, Sanity's Portable Text toolbar over the rich text field: block style, marks,
// link, lists and the field's insertable blocks, from the field's vocabulary (its
// schema `blocks`). Barkpark's canvas runs each command (<bp-paper-canvas> toolbar
// commands, EMBED-CONTRACT 1.2.0): one undo step, the same ops as its own menus, and
// can() / state() say what is allowed and pressed. On a Barkpark whose canvas has no
// toolbar commands the field keeps its expand button alone, as before.

type Command = 'toggleMark' | 'setBlockStyle' | 'toggleList' | 'insertBlock'
type ToolbarState = {marks: string[]; blockStyle: string | null; list: string | null; link: {href: string} | null}
type Canvas = HTMLElement & {
  run?: (command: Command, args?: object) => boolean
  can?: (command: Command, args?: object) => boolean
  state?: () => ToolbarState
}
type Vocabulary = {styles?: string[]; lists?: string[]; marks?: string[]; annotations?: {name: string}[]; of?: (string | {name: string; title?: string})[]}

const STYLES = ['normal', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']
const STYLE_LABEL: Record<string, string> = {normal: 'Normal', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', blockquote: 'Quote'}
// The canvas's mark names; the schema says strikethrough where the canvas says strike.
const MARKS: [mark: string, schema: string, label: string, icon: () => ReactNode][] = [
  ['strong', 'strong', 'Strong', BoldIcon],
  ['em', 'em', 'Italic', ItalicIcon],
  ['code', 'code', 'Code', CodeIcon],
  ['underline', 'underline', 'Underline', UnderlineIcon],
  ['strike', 'strikethrough', 'Strike', StrikeIcon],
]
const LISTS: [kind: string, label: string, icon: () => ReactNode][] = [
  ['bullet', 'Bulleted list', UlistIcon],
  ['number', 'Numbered list', OlistIcon],
]
const EMPTY: ToolbarState = {marks: [], blockStyle: null, list: null, link: null}

export function BodyToolbar({host, vocabulary, onWake}: {host: RefObject<HTMLElement | null>; vocabulary?: unknown; onWake?: () => void}) {
  const t = useT()
  const vocab = (vocabulary && typeof vocabulary === 'object' ? vocabulary : {}) as Vocabulary
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [state, setState] = useState<ToolbarState>(EMPTY)
  const [styleMenu, setStyleMenu] = useState(false)
  const [linking, setLinking] = useState(false)
  const rest = !!onWake
  // Whether the connected Barkpark's canvas has toolbar commands: its bundle is fetched
  // once the page is idle, so a field at rest shows the toolbar it will have.
  const [supported, setSupported] = useState(() => typeof (globalThis.customElements?.get('bp-paper-canvas') as {prototype?: Canvas} | undefined)?.prototype?.run === 'function')
  useEffect(() => {
    if (supported) return
    const idle = (globalThis as {requestIdleCallback?: (f: () => void) => number}).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200))
    let gone = false
    idle(() => void loadCanvas().then(() => !gone && setSupported(typeof (customElements.get('bp-paper-canvas') as {prototype?: Canvas} | undefined)?.prototype?.run === 'function')).catch(() => {}))
    return () => void (gone = true)
  }, [supported])
  // The canvas appears once its bundle has loaded; its commands only on a Barkpark that has them.
  useEffect(() => {
    setCanvas(null)
    if (rest) return
    const find = () => {
      const el = host.current?.querySelector<Canvas>('bp-paper-canvas')
      if (el && typeof el.run === 'function' && el.isConnected) return setCanvas(el), true
      return false
    }
    if (find()) return
    const timer = setInterval(() => find() && clearInterval(timer), 100)
    return () => clearInterval(timer)
  }, [host, rest])
  useEffect(() => {
    if (!canvas) return
    const read = () => setState({...EMPTY, ...canvas.state?.()})
    read()
    canvas.addEventListener('bp-selection-change', read)
    return () => canvas.removeEventListener('bp-selection-change', read)
  }, [canvas])

  const live = !!canvas
  // At rest a press wakes the field; live, a command runs on the selection.
  const can = (command: Command, args: object) => (live ? canvas!.can?.(command, args) === true : rest)
  const act = (command: Command, args: object) => {
    if (onWake) return onWake()
    if (canvas?.run?.(command, args)) setState({...EMPTY, ...canvas.state?.()})
  }
  const keepSelection = (e: React.MouseEvent) => e.preventDefault()
  const styles = (vocab.styles ?? STYLES).filter((s) => STYLES.includes(s))
  const marks = MARKS.filter(([, schema]) => !vocab.marks || vocab.marks.includes(schema))
  const lists = LISTS.filter(([kind]) => !vocab.lists || vocab.lists.includes(kind))
  const link = !vocab.annotations || vocab.annotations.some((a) => a.name === 'link')
  const inserts = (vocab.of ?? ['image', 'callout']).map((o) => (typeof o === 'string' ? {name: o, title: o === 'image' ? 'Image' : o === 'callout' ? 'Callout' : o} : {name: o.name, title: o.title ?? o.name}))
  const styleLabel = state.blockStyle ? t(STYLE_LABEL[state.blockStyle] ?? 'Normal') : t('No style')

  if (!supported) return <span className="body-toolbar" />
  return (
    <div className="body-toolbar" role="toolbar" aria-label={t('Formatting')} onMouseDown={keepSelection}>
      {styles.length > 0 && (
        // The style button takes focus (the canvas keeps its selection), so the menu returns
        // focus to it, inside this wrap, and leaving the wrap closes the menu.
        <div className="menu-wrap" onMouseDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setStyleMenu(false)}>
          <button type="button" className="body-style" aria-haspopup="menu" aria-expanded={styleMenu} disabled={live && !styles.some((s) => can('setBlockStyle', {style: s}))} onClick={() => (onWake ? onWake() : setStyleMenu((o) => !o))}>
            <span>{styleLabel}</span>
            <ChevronDown />
          </button>
          {styleMenu && (
            <MenuPopover onClose={() => setStyleMenu(false)}>
              {styles.map((style) => (
                <button key={style} type="button" role="menuitemradio" aria-checked={state.blockStyle === style} className={`menu-item body-style-${style}`} disabled={!can('setBlockStyle', {style})} onClick={() => (setStyleMenu(false), act('setBlockStyle', {style}))}>
                  {t(STYLE_LABEL[style]!)}
                </button>
              ))}
            </MenuPopover>
          )}
        </div>
      )}
      {marks.length > 0 && <span className="body-toolbar-sep" />}
      {marks.map(([mark, , label, Icon]) => (
        <ToolButton key={mark} label={t(label)} pressed={state.marks.includes(mark)} disabled={!can('toggleMark', {mark})} onClick={() => act('toggleMark', {mark})}>
          <Icon />
        </ToolButton>
      ))}
      {lists.length > 0 && <span className="body-toolbar-sep" />}
      {lists.map(([kind, label, Icon]) => (
        <ToolButton key={kind} label={t(label)} pressed={state.list === kind} disabled={!can('toggleList', {kind})} onClick={() => act('toggleList', {kind})}>
          <Icon />
        </ToolButton>
      ))}
      {link && (
        <>
          <span className="body-toolbar-sep" />
          <div className="menu-wrap">
            <ToolButton
              label={t('Link')}
              pressed={!!state.link}
              // A link in place is removed; otherwise the address is asked for (it needs a selection).
              disabled={live && !(state.link ? can('toggleMark', {mark: 'link'}) : can('toggleMark', {mark: 'link', href: 'https://example.com'}))}
              onClick={() => (onWake ? onWake() : state.link ? act('toggleMark', {mark: 'link'}) : setLinking(true))}
            >
              <LinkIcon />
            </ToolButton>
            {linking && <LinkInput onDone={(href) => (setLinking(false), href && act('toggleMark', {mark: 'link', href}))} />}
          </div>
        </>
      )}
      {inserts.length > 0 && <span className="body-toolbar-sep" />}
      {inserts.map(({name, title}) => (
        <button key={name} type="button" className="body-insert" aria-label={t('Insert {typeName} (block)', {typeName: t(title)})} disabled={!can('insertBlock', {type: name})} onClick={() => act('insertBlock', {type: name})}>
          {name === 'image' ? <ImageIcon /> : <BlockIcon />}
          <span>{t(title)}</span>
        </button>
      ))}
    </div>
  )
}

function ToolButton({label, pressed, disabled, onClick, children}: {label: string; pressed: boolean; disabled: boolean; onClick: () => void; children: ReactNode}) {
  return (
    <button type="button" className="icon-btn body-tool" aria-label={label} data-tip={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

/** The link's address, asked for in place (Enter sets it, Escape cancels). */
function LinkInput({onDone}: {onDone: (href: string | null) => void}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <div className="popover body-link" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        className="input"
        type="url"
        aria-label={t('Link')}
        placeholder="https://"
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.preventDefault(), onDone(e.currentTarget.value.trim() || null))
          if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onDone(null))
        }}
        onBlur={() => onDone(null)}
      />
    </div>
  )
}
