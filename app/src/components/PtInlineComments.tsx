import {useContext, useEffect, useId, useLayoutEffect, useRef, useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {useEditor, useEditorSelector} from '@portabletext/editor'
import {CommentsContext} from './Comments'
import {CommentOffer, DRAFT, moveSaver, paintCommentHighlights, selectionBox, useMayComment} from './InlineComments'
import {commentRangesOf, rangeMoves, type CommentSelection, type Point} from '../lib/comment-threads'
import {blockPoint, mapPtRanges, placedPtRanges, type PtRange} from '../lib/pt-comment-ranges'
import {caretOf} from '../lib/pt-value'
import {glide} from '../lib/layout'

// J40, Sanity's inline comments on a Portable Text field: select text, "Add comment" floats
// by it, and the thread is on that span, as on the canvas body (InlineComments, whose offer,
// composer and saving this shares). A span is a block's `_key` and an offset in its text at
// each end (lib/pt-comment-ranges.ts carries it through edits). Nothing is put in the text:
// the spans are painted with the CSS Custom Highlight API over the editor's own text nodes,
// so the caret, composition (IME) and other editors' typing never meet them.

/**
 * What the editor (remounted on a value from elsewhere) and the comments (kept, a composer
 * may be open) share: the editor's value as it last read it, and how to give it the focus.
 */
export type PtCommentBridge = {el?: HTMLElement | null; value?: unknown; caret?: Point | null; changed?: () => void; focus?: () => void}

/** Inside the editor: hands its value (once it has read it) and its caret to the comments. */
export function PtCommentValue({bridge, ready}: {bridge: PtCommentBridge; ready: boolean}) {
  const editor = useEditor()
  const value = useEditorSelector(editor, (s) => s.context.value)
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (!ready) return
    bridge.el = ref.current?.closest('.pt-input')?.querySelector<HTMLElement>('.pt-editable')
    bridge.focus = () => editor.send({type: 'focus'})
    // The caret says where this editor's own edit ended (not while the focus is elsewhere: the edit is another's).
    const sel = bridge.el?.contains(document.activeElement) ? caretOf(editor.getSnapshot().context.selection as never) : null
    bridge.caret = blockPoint(value, sel?.head)
    bridge.value = value
    bridge.changed?.()
  }, [bridge, editor, value, ready])
  return <span ref={ref} hidden />
}

const KEY = /^\[_key=="(.*)"\]$/
const blockOf = (root: HTMLElement, key: string) => [...root.children].find((e) => e.getAttribute('data-pt-path') === `[_key=="${key}"]`)
/** A block's text nodes as its value counts them: its spans' text (not an inline object's chip, not an empty line's filler). */
const textNodes = (block: Element) => [...block.querySelectorAll('[data-pt-inline="span"] [data-pt-text]')].flatMap((e) => [...e.childNodes].filter((n): n is Text => n.nodeType === Node.TEXT_NODE))

/** A place in the editor's DOM as a Point (its top-level text block's key, the offset in its text), or null outside one. */
function pointAt(root: HTMLElement, node: Node, offset: number): Point | null {
  const block = (node instanceof Element ? node : node.parentElement)?.closest('[data-pt-block="text"]')
  const key = block?.parentElement === root ? KEY.exec(block.getAttribute('data-pt-path') ?? '')?.[1] : undefined
  if (!block || key === undefined) return null
  const before = document.createRange()
  before.setStart(block, 0)
  before.setEnd(node, offset)
  let at = 0
  for (const n of textNodes(block)) {
    if (before.comparePoint(n, n.length) <= 0) at += n.length
    else return {blockId: key, offset: at + (n === node ? offset : 0)}
  }
  return {blockId: key, offset: at}
}

/** A Point as a place in the editor's DOM, or null when its block is not drawn. */
function domAt(root: HTMLElement, p: Point): [Node, number] | null {
  const block = blockOf(root, p.blockId)
  if (!block) return null
  let left = p.offset
  for (const n of textNodes(block)) {
    if (left <= n.length) return [n, left]
    left -= n.length
  }
  return [block, block.childNodes.length]
}

const overlap = (a: Range, b: Range) => a.compareBoundaryPoints(Range.END_TO_START, b) < 0 && a.compareBoundaryPoints(Range.START_TO_END, b) > 0
const holds = (r: Range, x: number, y: number) => [...r.getClientRects()].some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)

export function PtInlineComments({bridge, field, title}: {bridge: PtCommentBridge; field: string; title: string}) {
  const api = useContext(CommentsContext)
  const qc = useQueryClient()
  const paintKey = useId()
  const {canWrite, mayComment} = useMayComment()
  const [offer, setOffer] = useState<{selection: CommentSelection; box: DOMRect; overlap: boolean} | null>(null)
  const [draft, setDraft] = useState<{text: string; box: DOMRect} | null>(null)
  // What this editor holds, kept over its remounts: the value the spans were last mapped to,
  // each span as mapped since it was read (they win over the saved ones, which may lag
  // behind), the ones whose words went, the ones once painted, and the one being written about.
  const track = useRef({value: undefined as unknown, live: new Map<string, CommentSelection>(), gone: new Set<string>(), seen: new Set<string>(), draft: null as CommentSelection | null})
  const placed = useRef<(PtRange & {active?: boolean})[]>([])
  const painted = useRef<{id: string; range: Range; active?: boolean}[]>([])
  // The spans on the text as it is drawn now. Again whenever the editor redraws its text:
  // another editor's words are drawn after the value that holds them is read, into new text nodes.
  const paint = () => {
    const el = bridge.el
    painted.current = (el?.isConnected ? placed.current : []).flatMap((r) => {
      const [a, b] = [domAt(el!, r.anchor), domAt(el!, r.head)]
      if (!a || !b) return []
      const range = document.createRange()
      range.setStart(...a)
      range.setEnd(...b)
      return range.collapsed ? [] : [{id: r.id, range, active: r.active}]
    })
    const of = (active: boolean) => painted.current.filter((p) => !!p.active === active).map((p) => p.range)
    paintCommentHighlights(paintKey, {all: of(false), active: of(true)})
  }
  const paintRef = useRef(paint)
  paintRef.current = paint
  const watch = useRef<{on?: HTMLElement; redrawn?: MutationObserver}>({})
  useEffect(() => {
    const w = watch.current
    w.redrawn = new MutationObserver(() => placed.current.length && paintRef.current())
    if (w.on) w.redrawn.observe(w.on, {subtree: true, childList: true, characterData: true})
    return () => (w.redrawn?.disconnect(), (w.redrawn = undefined))
  }, [])
  const [saver] = useState(() => moveSaver(qc))
  const now = {api, canWrite, offer, draft, mayComment}
  const latest = useRef(now)
  latest.current = now

  // The spans follow the text, are painted, and the moved ones saved: on each value the
  // editor reads and whenever the threads change.
  const sync = () => {
    const {api, canWrite} = latest.current
    const t = track.current
    const el = bridge.el
    if (!api || !el?.isConnected || bridge.value === undefined) return
    const threads = commentRangesOf(api.threads, field, api.active, t.live).filter((r) => !t.gone.has(r.id))
    let ranges: (PtRange & {active?: boolean})[] = [...threads, ...(t.draft ? [{id: DRAFT, ...t.draft}] : [])]
    const edited = t.value !== undefined && t.value !== bridge.value
    if (edited) {
      const mapped = new Map(mapPtRanges(t.value, bridge.value, ranges, bridge.caret).map((r) => [r.id, r]))
      for (const r of threads) {
        const m = mapped.get(r.id)
        if (m) t.live.set(r.id, {anchor: m.anchor, head: m.head})
        else (t.live.delete(r.id), t.gone.add(r.id))
      }
      if (t.draft) t.draft = mapped.get(DRAFT) ?? null
      ranges = ranges.flatMap((r) => (mapped.has(r.id) ? [{...r, ...mapped.get(r.id)!}] : []))
    }
    t.value = bridge.value
    placed.current = placedPtRanges(bridge.value, ranges)
    if (watch.current.on !== el) {
      watch.current.redrawn?.disconnect()
      watch.current.redrawn?.observe(el, {subtree: true, childList: true, characterData: true})
      watch.current.on = el
    }
    paint()
    const there = placed.current.filter((r) => r.id !== DRAFT)
    for (const r of there) t.seen.add(r.id)
    // Saved after an edit only (never because a save came back: two editors that read one edit
    // differently would save over each other for good), and only a writer's edits move text.
    if (edited && canWrite) saver.queue(rangeMoves(api.threads, field, there, t.seen))
    // The words being written about were deleted: nothing to comment on.
    if (latest.current.draft && !t.draft) setDraft(null)
  }
  const syncRef = useRef(sync)
  syncRef.current = sync
  useEffect(() => {
    syncRef.current()
    return () => (saver.flush(), paintCommentHighlights(paintKey, null))
  }, [saver, paintKey])
  useLayoutEffect(() => {
    bridge.changed = () => syncRef.current()
    return () => void (bridge.changed = undefined)
  }, [bridge])
  const threadsKey = JSON.stringify(commentRangesOf(api?.threads ?? [], field, api?.active, new Map()))
  useLayoutEffect(() => syncRef.current(), [threadsKey, draft])

  // A thread picked in the panel: its words come into view.
  const active = api?.active
  useEffect(() => {
    const hit = painted.current.find((p) => p.id === active)
    if (hit) (hit.range.startContainer.parentElement ?? bridge.el)?.scrollIntoView({block: 'nearest', behavior: glide()})
  }, [active, bridge])

  const start = () => {
    const {offer} = latest.current
    if (!offer || offer.overlap) return
    track.current.draft = offer.selection
    setDraft({text: getSelection()?.toString() ?? '', box: offer.box})
    setOffer(null)
  }
  const startRef = useRef(start)
  startRef.current = start

  // The offer by a selection in the text, a click on a span, and the key that starts a comment.
  // On the page (the editor's element changes when it remounts), each asking where the text is now.
  useEffect(() => {
    let down = false
    const read = () => {
      const el = bridge.el
      const sel = getSelection()
      const box = el?.isConnected && !down && !latest.current.draft && latest.current.mayComment ? selectionBox(el) : null
      const range = box && sel!.getRangeAt(0)
      const [a, h] = range ? [pointAt(el!, range.startContainer, range.startOffset), pointAt(el!, range.endContainer, range.endOffset)] : []
      if (!box || !range || !a || !h || (a.blockId === h.blockId && a.offset === h.offset)) return setOffer((o) => (o ? null : o))
      setOffer({selection: {anchor: a, head: h}, box, overlap: painted.current.some((p) => p.id !== DRAFT && overlap(p.range, range))})
    }
    const inText = (e: Event) => !!bridge.el && e.target instanceof Node && bridge.el.contains(e.target)
    // Not while the selection is being dragged out: the button would sit under the pointer.
    const press = (e: Event) => inText(e) && ((down = true), read())
    const release = () => down && ((down = false), requestAnimationFrame(read))
    const click = (e: MouseEvent) => {
      if (!inText(e) || !getSelection()?.isCollapsed) return
      const hit = painted.current.find((p) => p.id !== DRAFT && holds(p.range, e.clientX, e.clientY))
      if (hit) latest.current.api?.open(field, hit.id)
    }
    // Mod+Alt+M, as other editors' "add comment": the offer's button without the mouse.
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'KeyM' || !e.altKey || !(e.metaKey || e.ctrlKey) || !inText(e) || !latest.current.offer) return
      e.preventDefault()
      startRef.current()
    }
    document.addEventListener('selectionchange', read)
    document.addEventListener('pointerdown', press, true)
    addEventListener('pointerup', release, true)
    addEventListener('pointercancel', release, true)
    addEventListener('scroll', read, true)
    addEventListener('resize', read)
    document.addEventListener('click', click)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('selectionchange', read)
      document.removeEventListener('pointerdown', press, true)
      removeEventListener('pointerup', release, true)
      removeEventListener('pointercancel', release, true)
      removeEventListener('scroll', read, true)
      removeEventListener('resize', read)
      document.removeEventListener('click', click)
      document.removeEventListener('keydown', key, true)
    }
  }, [bridge, field])

  if (!api || !mayComment) return null
  // Closed (sent, or Escape): the focus is back in the text, on what was selected.
  // After a comment the caret is at the end of its words (still selected, they would offer another).
  const done = (sent: boolean) => {
    track.current.draft = null
    setDraft(null)
    requestAnimationFrame(() => {
      if (bridge.el?.isContentEditable) bridge.focus?.()
      else bridge.el?.focus()
      if (sent) requestAnimationFrame(() => bridge.el?.contains(getSelection()?.focusNode ?? null) && getSelection()!.collapseToEnd())
    })
  }
  return <CommentOffer field={field} title={title} offer={offer} draft={draft} selection={() => track.current.draft} onStart={start} onDone={done} />
}
