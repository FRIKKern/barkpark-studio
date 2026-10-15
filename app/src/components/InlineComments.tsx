import {useContext, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {CommentsContext, Composer, newId} from './Comments'
import {moveCommentSelections, postComment, readerCommentsQuery} from '../lib/comments'
import {commentRangesOf, rangeMoves, type CommentSelection} from '../lib/comment-threads'
import {useCanWrite} from '../lib/session'
import {useT} from '../lib/i18n'
import {AddComment} from './icons'

// Sanity's inline comments: select text in the body, "Add comment" floats by it, and
// the thread is on that span. The canvas paints the spans and carries them through
// edits (Barkpark EMBED-CONTRACT 1.8, "Comment ranges"); the studio owns the threads.
// An older canvas has no setCommentRanges: then the body has field comments only.

type Range = {id: string; active?: boolean} & CommentSelection
type RangeCanvas = HTMLElement & {
  setCommentRanges(list: Range[]): void
  commentRanges(): ({id: string; text: string} & CommentSelection)[]
  commentsInSelection(): string[]
}

/** Barkpark 1.8+: the canvas paints comment ranges. */
const paintsRanges = (el: HTMLElement | null): el is RangeCanvas => typeof (el as Partial<RangeCanvas> | null)?.setCommentRanges === 'function'

// The span being commented on, highlighted while its composer is open (Sanity's authoring state).
const DRAFT = '__draft'
// Moved spans are saved once the edits around them settle.
const SAVE_AFTER_MS = 1200

/** Where the selection is on screen, or null when it is not in `el`. */
function selectionBox(el: HTMLElement) {
  const sel = getSelection()
  if (!sel?.rangeCount || sel.isCollapsed || !el.contains(sel.anchorNode)) return null
  const rects = sel.getRangeAt(0).getClientRects()
  return rects.length ? rects[rects.length - 1]! : null
}

export function InlineComments({canvas, field, title}: {canvas: HTMLElement | null; field: string; title: string}) {
  const api = useContext(CommentsContext)
  const t = useT()
  const qc = useQueryClient()
  const {canWrite} = useCanWrite()
  // J49: a read seat comments when the comment schema lets it (as FieldComments).
  const {data: readers} = useQuery({...readerCommentsQuery, enabled: !canWrite})
  const el = paintsRanges(canvas) ? canvas : null
  const [offer, setOffer] = useState<{selection: CommentSelection; box: DOMRect; overlap: boolean} | null>(null)
  const [draft, setDraft] = useState<{selection: CommentSelection; text: string; box: DOMRect} | null>(null)
  // The Points the canvas has mapped through edits, newest first; ids it has painted.
  const live = useRef(new Map<string, CommentSelection>())
  const seen = useRef(new Set<string>())
  const threads = api?.threads ?? []
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const apiRef = useRef(api)
  apiRef.current = api

  const ranges: Range[] = [...commentRangesOf(threads, field, api?.active, live.current), ...(draft ? [{id: DRAFT, ...draft.selection, active: true}] : [])]
  const rangesRef = useRef(ranges)
  rangesRef.current = ranges
  // Handed over when a thread comes or goes or another is picked, not on every save of
  // moved Points: the canvas already holds those, and the saved ones may lag behind.
  const rangesKey = JSON.stringify(ranges.map((r) => [r.id, r.active]))
  useEffect(() => {
    if (!el) return
    el.setCommentRanges(rangesRef.current)
    for (const r of el.commentRanges()) seen.current.add(r.id)
  }, [el, rangesKey])

  useEffect(() => {
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = new Map<string, CommentSelection | null>()
    const save = () => {
      const moves = [...pending].map(([id, selection]) => ({id, selection}))
      pending = new Map()
      if (moves.length) void moveCommentSelections({data: {moves}}).then(() => qc.invalidateQueries({queryKey: ['comments']}), () => {})
    }
    const onRanges = (e: Event) => {
      const list = (e as CustomEvent<({id: string} & CommentSelection)[]>).detail.filter((r) => r.id !== DRAFT)
      live.current = new Map(list.map((r) => [r.id, {anchor: r.anchor, head: r.head}]))
      for (const r of list) seen.current.add(r.id)
      // Only a writer's edits move text; a read seat's canvas never sends one.
      if (!canWrite) return
      for (const m of rangeMoves(threadsRef.current, field, list, seen.current)) pending.set(m.id, m.selection)
      clearTimeout(timer)
      timer = setTimeout(save, SAVE_AFTER_MS)
    }
    const onClick = (e: Event) => {
      const {id} = (e as CustomEvent<{id: string}>).detail
      if (id !== DRAFT) apiRef.current?.open(field, id)
    }
    const onSelection = (e: Event) => {
      const sel = (e as CustomEvent<CommentSelection | null>).detail
      const box = sel && JSON.stringify(sel.anchor) !== JSON.stringify(sel.head) ? selectionBox(el) : null
      setOffer(sel && box ? {selection: sel, box, overlap: el.commentsInSelection().length > 0} : null)
    }
    el.addEventListener('bp-canvas-comment-ranges', onRanges)
    el.addEventListener('bp-canvas-comment-click', onClick)
    el.addEventListener('bp-canvas-selection', onSelection)
    return () => {
      el.removeEventListener('bp-canvas-comment-ranges', onRanges)
      el.removeEventListener('bp-canvas-comment-click', onClick)
      el.removeEventListener('bp-canvas-selection', onSelection)
      clearTimeout(timer)
      save()
    }
  }, [el, field, canWrite])

  // The button follows its text as the pane scrolls.
  useEffect(() => {
    if (!el || !offer) return
    const place = () => {
      const box = selectionBox(el)
      setOffer((o) => (o && box ? {...o, box} : null))
    }
    addEventListener('scroll', place, true)
    return () => removeEventListener('scroll', place, true)
  }, [el, !!offer])

  if (!el || !api || !(canWrite || readers)) return null
  const start = () => {
    if (!offer || offer.overlap) return
    setDraft({selection: offer.selection, text: getSelection()?.toString() ?? '', box: offer.box})
    setOffer(null)
  }
  return createPortal(
    <>
      {offer && !draft && (
        <button
          type="button"
          className="inline-comment-add"
          aria-disabled={offer.overlap || undefined}
          title={offer.overlap ? t('Comments cannot overlap') : undefined}
          style={{top: offer.box.bottom + 6, left: Math.max(8, Math.min(offer.box.right - 16, innerWidth - 150))}}
          // Keeps the selection: a press elsewhere would collapse it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={start}
        >
          <AddComment /> {t('Add comment')}
        </button>
      )}
      {draft && (
        <div className="popover comment-popover" style={{position: 'fixed', top: draft.box.bottom + 6, left: Math.max(8, Math.min(draft.box.right - 160, innerWidth - 328))}}>
          <Composer
            label={t('Add comment to {field}', {field: title})}
            placeholder={<>{t('Add comment to')} <strong>{title}</strong></>}
            autoFocus
            onSend={async (message) => {
              const id = newId()
              await postComment({data: {id, documentId: api.docId, documentType: api.docType, fieldPath: field, message, selection: draft.selection, contentSnapshot: draft.text}})
              // The thread's own highlight is there before the draft's goes.
              await qc.invalidateQueries({queryKey: ['comments']})
              setDraft(null)
              api.open(field, id)
            }}
            onCancel={() => setDraft(null)}
          />
        </div>
      )}
    </>,
    document.body,
  )
}
