import {useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {DragHandle} from './icons'
import {toast} from './Toasts'
import {announce} from '../lib/announce'
import {previewTitle, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {applyServer, reasonOf} from '../lib/edits'
import {useT} from '../lib/i18n'
import {compareRanks, isRank, RANK_FIELD, rankAll, rankAtEnd, rankMove, reorder} from '../lib/order-rank'
import {saveRanks, type RankSaved} from '../lib/order-save'

// Sanity's orderable document list (@sanity/orderable-document-list): a list sorted by its
// manual order (`orderRank asc`) gets a handle on every row. Drag a row (pointer; or Space
// on its handle, arrows, Space, as the array rows of SortableRows; or Alt+Up / Alt+Down on
// the row) and its new place is saved at once: one rank between its new neighbours
// (lib/order-rank.ts), written to that one document (lib/order-save.ts).
//
//   drop ─► the row shows in its new place (the rank held here, `pending`)
//        ─► saveRanks ─► ok: the saved document goes into the cache, `pending` lets go
//                     └► refused: `pending` lets go (the row is back), a toast says why
//
// Rows with no rank yet (new, imported) sort last; the first move, or "Reset order" in the
// list menu, ranks every row in the order shown. The list (Structure's ListPane) calls
// this with what it would draw and draws what it gets back; with `on` false it gets its
// own rows back and nothing here shows.

type Moving = {id: string; from: number; to: number; keys: boolean}

export type Orderable = {
  on: boolean
  /** The rows to draw: in manual order, a row being moved (or saved) in its new place. */
  rows: Doc[]
  /** Attributes for a row's list item. */
  rowProps: (doc: Doc, at: number) => Record<string, string | number | undefined>
  /** A row's drag handle (nothing when off). */
  handle: (doc: Doc, at: number) => ReactNode
  /** The list's keys: true when the key was a move and is taken. */
  onKey: (e: KeyboardEvent<HTMLElement>) => boolean
  /** Above the rows: how to move by keyboard (for a screen reader), and what is unranked. */
  notice: ReactNode
  /** "Reset order": every row ranked anew, evenly, in the order shown. */
  reset: () => void
  /** What a document made from this list starts with: a rank after the last row. */
  newDocValues: () => Record<string, unknown>
}

const idOf = (d: Doc) => d._publishedId

export function useOrderableRows({on, type, shown, direct}: {on: boolean; type: string; shown: Doc[]; /** The editor may publish: a published document's rank is written to it, not to a new draft. */ direct: boolean}): Orderable {
  const t = useT()
  const qc = useQueryClient()
  const helpId = useId()
  const {data: schemas = []} = useQuery(schemasQuery)
  // Ranks dropped and not yet back from the server, by document.
  const [pending, setPending] = useState<Map<string, string>>(() => new Map())
  const [moving, setMoving] = useState<Moving | null>(null)
  const list = useRef<HTMLElement | null>(null)

  const base = useMemo(() => {
    if (!on) return shown
    const held = pending.size ? shown.map((d) => (pending.has(idOf(d)) ? ({...d, [RANK_FIELD]: pending.get(idOf(d))} as Doc) : d)) : shown
    // By code unit, as Barkpark sorts them (the list's own sort collates by locale); ties and unranked rows keep the list's order.
    return [...held].sort((a, b) => compareRanks(a[RANK_FIELD], b[RANK_FIELD]))
  }, [on, shown, pending])
  // A row leaving the list mid-move (someone deleted it) ends the move.
  const live = on && moving && base[moving.from] && idOf(base[moving.from]!) === moving.id ? moving : null
  const rows = useMemo(() => (live ? reorder(base, live.from, live.to) : base), [base, live])
  const unranked = on ? base.filter((d) => !isRank(d[RANK_FIELD])).length : 0

  const title = (d: Doc) => previewTitle(d, schemaOf(schemas, type), t)
  const focusIn = (id: string, what: '.order-handle' | 'a[href]') =>
    requestAnimationFrame(() => {
      const el = list.current?.querySelector<HTMLElement>(`[data-order-id="${CSS.escape(id)}"] ${what}`)
      el?.focus({preventScroll: true})
      el?.scrollIntoView({block: 'nearest'})
    })

  async function save(writes: {doc: Doc; rank: string}[]): Promise<boolean> {
    if (!writes.length) return true
    setPending((m) => new Map([...m, ...writes.map((w) => [idOf(w.doc), w.rank] as const)]))
    // A later move of the same row holds its own rank: only ours lets go.
    const letGo = () =>
      setPending((m) => {
        const next = new Map(m)
        for (const w of writes) if (next.get(idOf(w.doc)) === w.rank) next.delete(idOf(w.doc))
        return next
      })
    try {
      const saved = (await saveRanks({data: {type, writes: writes.map((w) => ({id: idOf(w.doc), rank: w.rank, direct: direct && !w.doc._draft}))}})) as unknown as RankSaved
      for (const d of saved.docs) applyServer(qc, d)
      letGo()
      // Written to a draft whose published version keeps its old place until the draft is published.
      const waiting = writes.filter((w) => saved.waiting.includes(idOf(w.doc)) && w.doc._hasPublished)
      if (waiting.length === 1) toast({tone: 'caution', title: t('{title} has unpublished changes: its new place goes live when it is published.', {title: title(waiting[0]!.doc)})})
      else if (waiting.length) toast({tone: 'caution', title: t('{n} documents have unpublished changes: their new places go live when they are published.', {n: waiting.length})})
      return true
    } catch (err) {
      letGo()
      const message = (err as Error).message
      toast({tone: 'critical', title: t('Could not save the new order'), description: reasonOf(message) ?? message})
      return false
    }
  }

  /** Row `from` of the list as it stands (no move shown) goes to place `to`. */
  const drop = (from: number, to: number) => {
    const {base} = latest.current
    const moved = base[from]
    const writes = rankMove(base.map((d) => d[RANK_FIELD]), from, to).map((w) => ({doc: base[w.at]!, rank: w.rank}))
    if (!moved || !writes.length) return
    announce(t('{title} moved to place {n} of {total}', {title: title(moved), n: to + 1, total: base.length}))
    void save(writes)
  }

  const latest = useRef({base, rows, moving: live})
  latest.current = {base, rows, moving: live}

  const onHandleKey = (doc: Doc, at: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const m = latest.current.moving
    if (e.altKey || e.metaKey || e.ctrlKey) return
    const taken = () => (e.preventDefault(), e.stopPropagation())
    list.current = e.currentTarget.closest('.list-rows')
    if (e.key === ' ' || e.key === 'Enter') {
      taken()
      if (!m) return setMoving({id: idOf(doc), from: at, to: at, keys: true})
      setMoving(null)
      drop(m.from, m.to)
      focusIn(m.id, '.order-handle')
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      taken()
      const step = e.key === 'ArrowDown' ? 1 : -1
      const to = Math.max(0, Math.min(latest.current.rows.length - 1, (m ? m.to : at) + step))
      if (m) setMoving({...m, to})
      const next = m ? m.id : latest.current.rows[to] && idOf(latest.current.rows[to]!)
      if (next) focusIn(next, '.order-handle')
    } else if (e.key === 'Escape' && m) {
      taken()
      setMoving(null)
      focusIn(m.id, '.order-handle')
    } else if (e.key === 'ArrowRight') {
      taken()
      focusIn(idOf(doc), 'a[href]')
    }
  }
  // A row picked up by keyboard and then left (a click elsewhere, Tab) is put back.
  const onHandleBlur = () =>
    setTimeout(() => latest.current.moving?.keys && !document.activeElement?.classList.contains('order-handle') && setMoving(null), 150)

  // Pointer drag, as SortableRows: the row takes the slot given by how many other rows'
  // midpoints are above the pointer. Listeners sit on the window, so moving the row in the
  // DOM never drops the drag. Escape cancels; near an edge of a long list, it scrolls.
  const onPointerDown = (doc: Doc, from: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || latest.current.moving) return
    e.preventDefault()
    const box = e.currentTarget.closest<HTMLElement>('.list-rows')
    list.current = box
    const id = idOf(doc)
    let to = from
    setMoving({id, from, to, keys: false})
    const move = (ev: globalThis.PointerEvent) => {
      const els = [...(box?.querySelectorAll<HTMLElement>('[data-order-at]') ?? [])].filter((r) => Number(r.dataset.orderAt) !== to)
      const place = (r: HTMLElement) => (Number(r.dataset.orderAt) < to ? Number(r.dataset.orderAt) : Number(r.dataset.orderAt) - 1)
      const above = els.filter((r) => r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2 < ev.clientY)
      const slot = above.length ? place(above.at(-1)!) + 1 : els.length ? place(els[0]!) : 0
      if (slot !== to) setMoving({id, from, to: (to = slot), keys: false})
      const view = box?.getBoundingClientRect()
      if (box && view && ev.clientY < view.top + 40) box.scrollTop -= 12
      else if (box && view && ev.clientY > view.bottom - 40) box.scrollTop += 12
    }
    const end = (ev: Event) => {
      if (ev instanceof globalThis.KeyboardEvent && ev.key !== 'Escape') return
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', end)
      removeEventListener('pointercancel', end)
      removeEventListener('keydown', end, true)
      setMoving(null)
      if (ev.type === 'pointerup' && to !== from) drop(from, to)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', end)
    addEventListener('pointercancel', end)
    addEventListener('keydown', end, true)
  }

  const onKey = (e: KeyboardEvent<HTMLElement>): boolean => {
    if (!on || e.metaKey || e.ctrlKey || e.shiftKey) return false
    const target = e.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-order-id]')
    if (!row) return false
    list.current = e.currentTarget
    const at = Number(row.dataset.orderAt)
    const id = row.dataset.orderId!
    const onLink = !!target.closest('a[href]')
    // Alt+Up / Alt+Down: the row moves one place and is saved, focus kept on it.
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !latest.current.moving) {
      e.preventDefault()
      const to = at + (e.key === 'ArrowDown' ? 1 : -1)
      if (to >= 0 && to < latest.current.base.length) (drop(at, to), focusIn(id, onLink ? 'a[href]' : '.order-handle'))
      return true
    }
    // The handles are off the Tab order (the list stays one Tab stop): Left arrow reaches a row's.
    if (e.key === 'ArrowLeft' && onLink && !e.altKey) {
      e.preventDefault()
      focusIn(id, '.order-handle')
      return true
    }
    return false
  }

  return {
    on,
    rows,
    rowProps: (doc, at) => (on ? {'data-orderable': '', 'data-order-id': idOf(doc), 'data-order-at': at, 'data-moving': live?.id === idOf(doc) ? '' : undefined} : {}),
    handle: (doc, at) =>
      on ? (
        <button
          type="button"
          className="icon-btn drag-handle order-handle"
          tabIndex={-1}
          aria-roledescription={t('sortable')}
          aria-label={t('Move item {n}', {n: at + 1})}
          aria-describedby={helpId}
          data-tip={t('Drag to re-order')}
          aria-pressed={live?.id === idOf(doc)}
          onKeyDown={onHandleKey(doc, at)}
          onBlur={onHandleBlur}
          onPointerDown={onPointerDown(doc, at)}
        >
          <DragHandle />
        </button>
      ) : null,
    onKey,
    notice: on ? (
      <>
        <p id={helpId} hidden>
          {t('To move a document, press Left arrow on its row to reach its handle, then Space or Enter to pick it up. Use the arrow keys to move it, Space or Enter to drop, Escape to cancel. Alt+Up and Alt+Down move a row one place.')}
        </p>
        {unranked > 0 && (
          <p className="order-note" role="status">
            {t('{n} of {total} documents have no place in the order yet. Drag one, or choose Reset order in the list menu.', {n: unranked, total: base.length})}
          </p>
        )}
      </>
    ) : null,
    reset: () => {
      const {base} = latest.current
      const writes = rankAll(base.map((d) => d[RANK_FIELD])).map((w) => ({doc: base[w.at]!, rank: w.rank}))
      void save(writes).then((ok) => ok && toast({tone: 'positive', title: t('Order reset')}))
    },
    newDocValues: () => {
      // Among rows with no rank yet a ranked newcomer would sort first: it joins them, last.
      const ranks = latest.current.base.map((d) => d[RANK_FIELD])
      const rank = on && ranks.every(isRank) ? rankAtEnd(ranks) : null
      return rank ? {[RANK_FIELD]: rank} : {}
    },
  }
}
