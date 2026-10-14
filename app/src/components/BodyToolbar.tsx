import {Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject} from 'react'
import {MenuPopover} from './FocusScopes'
import {BlockIcon, BoldIcon, ChevronDown, CodeIcon, DocLinkIcon, Ellipsis, ImageIcon, InlineIcon, ItalicIcon, LinkIcon, OlistIcon, StrikeIcon, UlistIcon, UnderlineIcon} from './icons'
import {useT} from '../lib/i18n'
import {loadCanvas} from '../lib/canvas-bundle'
import {linkHref} from '../lib/link-href'

// J10, Sanity's Portable Text toolbar over the rich text field: block style, marks,
// link, lists and the field's insertable blocks, from the field's vocabulary (its
// schema `blocks`). Barkpark's canvas runs each command (<bp-paper-canvas> toolbar
// commands, EMBED-CONTRACT 1.2.0): one undo step, the same ops as its own menus, and
// can() / state() say what is allowed and pressed. On a Barkpark whose canvas has no
// toolbar commands the field keeps its expand button alone, as before.

type Command = 'toggleMark' | 'setBlockStyle' | 'toggleList' | 'insertBlock' | 'insertInline'
type ToolbarState = {marks: string[]; blockStyle: string | null; list: string | null; link: {href: string} | null; wikilink?: {target: string; docId: string | null} | null}
type DocHit = {title: string; id: string; type: string}
type Canvas = HTMLElement & {
  /** The canvas's own `[[` document search, which the studio sets (PortableDocEditor). */
  wikilinkSource?: ((query: string) => Promise<DocHit[]>) | null
  run?: (command: Command, args?: object) => boolean
  can?: (command: Command, args?: object) => boolean
  state?: () => ToolbarState
}
type Vocabulary = {styles?: string[]; lists?: string[]; marks?: string[]; annotations?: {name: string; fields?: {name: string; to?: {type: string}[]}[]}[]; of?: (string | {name: string; title?: string})[]; inline?: (string | {name: string; title?: string})[]}

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
  // The link input, open with the address it starts from ('' for a new link).
  const [linking, setLinking] = useState<string | null>(null)
  const [docLinking, setDocLinking] = useState(false)
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
    // Sanity draws no floating bubble: this toolbar is the field's only one (Barkpark
    // #23026; an older canvas ignores the attribute). Mod+K and the link card's Edit then
    // ask here, with the link's address, and open this toolbar's link input.
    canvas.setAttribute('format-bubble', 'off')
    const askLink = (e: Event) => (e.preventDefault(), setLinking((e as CustomEvent<{href: string | null}>).detail?.href ?? ''))
    canvas.addEventListener('bp-canvas-link-request', askLink)
    return () => (canvas.removeEventListener('bp-selection-change', read), canvas.removeEventListener('bp-canvas-link-request', askLink))
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
  // Sanity's internalLink (a link to a document) is the canvas's document link, wikilink
  // (Barkpark 1.7+), declared under either name. A reference's `to` narrows the search.
  const internal = vocab.annotations?.find((a) => a.name === 'internalLink' || a.name === 'wikilink')
  const internalTypes = internal?.fields?.flatMap((f) => f.to?.map((x) => x.type) ?? []) ?? []
  const inserts = (vocab.of ?? ['image', 'callout']).map((o) => (typeof o === 'string' ? {name: o, title: o === 'image' ? 'Image' : o === 'callout' ? 'Callout' : o} : {name: o.name, title: o.title ?? o.name}))
  // Sanity's inline objects (a chip) after the blocks: "Insert Chip (inline)" (Barkpark 1.6+).
  const inlines = (vocab.inline ?? []).map((o) => (typeof o === 'string' ? {name: o, title: o} : {name: o.name, title: o.title ?? o.name})).map((o) => ({...o, title: o.title.charAt(0).toUpperCase() + o.title.slice(1)}))
  const styleLabel = state.blockStyle ? t(STYLE_LABEL[state.blockStyle] ?? 'Normal') : t('No style')

  // J47: one Tab stop, as a WAI-ARIA toolbar: arrow keys, Home and End move along its
  // buttons (a screen reader announces it as a toolbar, so its users press those).
  const bar = useRef<HTMLDivElement>(null)
  const at = useRef(0)
  const tools = () => [...(bar.current?.querySelectorAll<HTMLButtonElement>(':scope > .menu-wrap > button, :scope > .body-tool-slot > button, :scope > .body-tool-slot > .menu-wrap > button') ?? [])].filter((b) => !b.disabled)
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
    const next = i < 0 ? -1 : {ArrowRight: (i + 1) % list.length, ArrowLeft: (i - 1 + list.length) % list.length, Home: 0, End: list.length - 1}[e.key] ?? -1
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

  // Sanity's fold: a narrow field puts the tail of each group (the marks, lists and links;
  // the inserts) behind a "Show more" menu at that group's end, so nothing spills past the
  // field. Widths are read with everything shown and kept per tool.
  type Tool = {key: string; label: string; icon: ReactNode; pressed?: boolean; disabled: boolean; run: () => void; node: ReactNode; sep?: boolean}
  const linkPopover = linking !== null && <LinkInput initial={linking} onDone={(href) => (setLinking(null), href && act('toggleMark', {mark: 'link', href}))} />
  const docPopover = docLinking && canvas?.wikilinkSource && (
    <DocLinkInput search={canvas.wikilinkSource} types={internalTypes} onDone={(hit) => (setDocLinking(false), hit && act('toggleMark', {mark: 'wikilink', docId: hit.id, target: hit.title}))} />
  )
  const actions: Tool[] = [
    ...marks.map(([mark, , label, Icon]): Tool => ({key: mark, label: t(label), icon: <Icon />, pressed: state.marks.includes(mark), disabled: !can('toggleMark', {mark}), run: () => act('toggleMark', {mark}), node: null})),
    ...lists.map(([kind, label, Icon], i): Tool => ({key: kind, label: t(label), icon: <Icon />, pressed: state.list === kind, disabled: !can('toggleList', {kind}), run: () => act('toggleList', {kind}), node: null, sep: i === 0 && marks.length > 0})),
  ]
  for (const tool of actions) tool.node = <ToolButton label={tool.label} pressed={!!tool.pressed} disabled={tool.disabled} onClick={tool.run}>{tool.icon}</ToolButton>
  if (link) {
    // A link in place is removed; otherwise the address is asked for (it needs a selection).
    const run = () => (onWake ? onWake() : state.link ? act('toggleMark', {mark: 'link'}) : setLinking(''))
    const disabled = live && !(state.link ? can('toggleMark', {mark: 'link'}) : can('toggleMark', {mark: 'link', href: 'https://example.com'}))
    actions.push({key: 'link', label: t('Link'), icon: <LinkIcon />, pressed: !!state.link, disabled, run, sep: actions.length > 0, node: (
      <div className="menu-wrap">
        <ToolButton label={t('Link')} pressed={!!state.link} disabled={disabled} onClick={run}><LinkIcon /></ToolButton>
        {linkPopover}
      </div>
    )})
  }
  if (internal) {
    // One in place is removed; otherwise a document is asked for (it needs a selection).
    const run = () => (onWake ? onWake() : state.wikilink ? act('toggleMark', {mark: 'wikilink'}) : setDocLinking(true))
    const disabled = live && !(state.wikilink ? can('toggleMark', {mark: 'wikilink'}) : can('toggleMark', {mark: 'wikilink', docId: 'x'}))
    actions.push({key: 'wikilink', label: t('Internal link'), icon: <DocLinkIcon />, pressed: !!state.wikilink, disabled, run, sep: actions.length > 0 && !link, node: (
      <div className="menu-wrap">
        <ToolButton label={t('Internal link')} pressed={!!state.wikilink} disabled={disabled} onClick={run}><DocLinkIcon /></ToolButton>
        {docPopover}
      </div>
    )})
  }
  const insertTool = (name: string, title: string, kind: 'block' | 'inline', icon: ReactNode): Tool => {
    const label = kind === 'block' ? t('Insert {typeName} (block)', {typeName: t(title)}) : t('Insert {typeName} (inline)', {typeName: t(title)})
    const command = kind === 'block' ? 'insertBlock' : 'insertInline'
    const disabled = !can(command, {type: name})
    const run = () => act(command, {type: name})
    return {key: `${kind}:${name}`, label: t(title), icon, disabled, run, node: (
      <button type="button" className="body-insert" aria-label={label} disabled={disabled} onClick={run}>
        {icon}
        <span>{t(title)}</span>
      </button>
    )}
  }
  const insertTools = [
    ...inserts.map(({name, title}) => insertTool(name, title, 'block', name === 'image' ? <ImageIcon /> : <BlockIcon />)),
    ...inlines.map(({name, title}) => insertTool(name, title, 'inline', <InlineIcon />)),
  ]

  const widths = useRef(new Map<string, number>())
  const [folded, setFolded] = useState<[number, number]>([0, 0])
  const toolKeys = [...actions, ...insertTools].map((x) => x.key).join()
  // Everything shown again when the tools change, to measure them.
  useLayoutEffect(() => setFolded([0, 0]), [toolKeys])
  const SEP = 8 // a separator: 1 px, its 6 px margin and the 1 px gap after it
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const fit = () => {
      for (const tool of el.querySelectorAll<HTMLElement>('[data-tool]')) widths.current.set(tool.dataset.tool!, tool.offsetWidth + 1)
      const width = (tools: Tool[]) => tools.reduce((sum, x) => sum + (widths.current.get(x.key) ?? 25) + (x.sep ? SEP : 0), 0)
      // Each part counts its width and the 1 px gap after it. Fixed: the style menu and the groups' separators.
      const style = el.querySelector<HTMLElement>(':scope > .body-style-wrap')
      let fixed = style ? style.offsetWidth + 1 : 0
      if (actions.length && styles.length) fixed += SEP
      if (insertTools.length) fixed += SEP
      const more = 26
      // The last tool has no gap after it: that 1 px is kept for rounding.
      const room = el.clientWidth - fixed
      const shown = [actions.length, insertTools.length]
      const need = () => width(actions.slice(0, shown[0])) + width(insertTools.slice(0, shown[1])) + (shown[0] < actions.length ? more : 0) + (shown[1] < insertTools.length ? more : 0)
      // Fold one at a time from the end of the wider group, as Sanity's two menus share the room.
      while (need() > room && shown[0] + shown[1] > 0) {
        const a = width(actions.slice(0, shown[0]))
        const b = width(insertTools.slice(0, shown[1]))
        if ((a >= b && shown[0] > 0) || shown[1] === 0) shown[0]--
        else shown[1]--
      }
      const next: [number, number] = [actions.length - shown[0], insertTools.length - shown[1]]
      setFolded((f) => (f[0] === next[0] && f[1] === next[1] ? f : next))
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    return () => watch.disconnect()
  }, [toolKeys, supported, folded])
  const [moreMenu, setMoreMenu] = useState<0 | 1 | null>(null)
  const group = (tools: Tool[], fold: number, which: 0 | 1) => {
    const shown = tools.slice(0, tools.length - fold)
    const rest = tools.slice(tools.length - fold)
    return (
      <>
        {shown.map((tool) => (
          <Fragment key={tool.key}>
            {tool.sep && <span className="body-toolbar-sep" />}
            <span className="body-tool-slot" data-tool={tool.key}>{tool.node}</span>
          </Fragment>
        ))}
        {rest.length > 0 && (
          <div className="menu-wrap body-more-wrap" onMouseDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMoreMenu(null)}>
            <button type="button" className="icon-btn body-tool" aria-label={t('Show more')} data-tip={t('Show more')} aria-haspopup="menu" aria-expanded={moreMenu === which} onClick={() => (onWake ? onWake() : setMoreMenu((m) => (m === which ? null : which)))}>
              <Ellipsis />
            </button>
            {moreMenu === which && (
              <MenuPopover onClose={() => setMoreMenu(null)}>
                {rest.map((tool) => (
                  <button key={tool.key} type="button" role={tool.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={tool.pressed} className="menu-item body-more-item" disabled={tool.disabled} onClick={() => (setMoreMenu(null), tool.run())}>
                    {tool.icon}
                    <span>{tool.label}</span>
                  </button>
                ))}
              </MenuPopover>
            )}
            {which === 0 && rest.some((x) => x.key === 'link') && linkPopover}
            {which === 0 && rest.some((x) => x.key === 'wikilink') && docPopover}
          </div>
        )}
      </>
    )
  }

  if (!supported) return <span className="body-toolbar" />
  return (
    <div ref={bar} className="body-toolbar" role="toolbar" aria-label={t('Formatting')} onMouseDown={keepSelection} onKeyDown={rove} onFocus={focused}>
      {styles.length > 0 && (
        // The style button takes focus (the canvas keeps its selection), so the menu returns
        // focus to it, inside this wrap, and leaving the wrap closes the menu.
        <div className="menu-wrap body-style-wrap" onMouseDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setStyleMenu(false)}>
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
      {actions.length > 0 && styles.length > 0 && <span className="body-toolbar-sep" />}
      {group(actions, folded[0], 0)}
      {insertTools.length > 0 && <span className="body-toolbar-sep" />}
      {group(insertTools, folded[1], 1)}
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

/** The document an internal link goes to, searched in place as the canvas's `[[` menu
 *  searches (its wikilinkSource): Up/Down and Enter or a click pick, Escape cancels. */
function DocLinkInput({search, types, onDone}: {search: (query: string) => Promise<DocHit[]>; types: string[]; onDone: (hit: DocHit | null) => void}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DocHit[]>([])
  const [active, setActive] = useState(0)
  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      void search(query)
        .then((all) => live && (setHits(all.filter((h) => !types.length || types.includes(h.type)).slice(0, 8)), setActive(0)))
        .catch(() => live && setHits([]))
    }, 150)
    return () => ((live = false), clearTimeout(timer))
  }, [query])
  return (
    <div className="popover body-link body-doclink" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        className="input"
        type="search"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls="body-doclink-list"
        aria-activedescendant={hits[active] ? `body-doclink-${active}` : undefined}
        aria-label={t('Internal link')}
        placeholder={t('Search documents')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => (hits.length ? (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length : 0)))
          if (e.key === 'Enter') (e.preventDefault(), hits[active] && onDone(hits[active]))
          if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onDone(null))
        }}
        onBlur={() => onDone(null)}
      />
      <ul className="body-doclink-list" id="body-doclink-list" role="listbox" aria-label={t('Documents')}>
        {hits.map((h, i) => (
          <li key={h.id} id={`body-doclink-${i}`} role="option" aria-selected={i === active} className="menu-item" onMouseDown={(e) => (e.preventDefault(), onDone(h))}>
            {h.title}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The link's address, asked for in place (Enter sets it, Escape cancels). Only the
 *  reader's allowlist is taken (lib/link-href.ts): anything else says so and stays open. */
function LinkInput({initial, onDone}: {initial: string; onDone: (href: string | null) => void}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [refused, setRefused] = useState(false)
  useEffect(() => input.current?.focus(), [])
  return (
    <div className="popover body-link" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        className="input"
        defaultValue={initial}
        type="url"
        aria-label={t('Link')}
        aria-invalid={refused || undefined}
        aria-describedby={refused ? 'body-link-refused' : undefined}
        placeholder="https://"
        onChange={() => setRefused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const raw = e.currentTarget.value
            if (!raw.trim()) return onDone(null)
            const href = linkHref(raw)
            return href ? onDone(href) : setRefused(true)
          }
          if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onDone(null))
        }}
        onBlur={() => onDone(null)}
      />
      {refused && (
        <p className="body-link-refused" id="body-link-refused" role="alert">
          {t('Use a web, mail or phone address (https:, mailto:, tel:) or a path.')}
        </p>
      )}
    </div>
  )
}
