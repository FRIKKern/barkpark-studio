import {useCallback, useEffect, useMemo, useRef, useState, type RefObject} from 'react'
import {useDocSelect} from './Fields'
import {useT} from '../lib/i18n'
import {newKey} from '../lib/pt-value'
import {setCell, tableGrid, type TableWrite} from '../lib/table-input'
import {typedSince} from '../lib/table-keep'
import {dropKept, keepTyped, setKeptText, useTableKept, type KeptText} from '../lib/table-kept'

// Text of mine a table change left out (lib/table-keep.ts: the other editor added or removed a
// column while I typed, or wrote the same cell), on a card under the table, as the canvas offers
// its kept words (PortableDocEditor's "Put the words back"): each text with Copy, Put it back and
// Dismiss. The caret moves onto the card when its own cell's text was kept, so typing goes on
// there and no key lands in the other editor's cell.

/** A kept text this new is the one the caret was typing (older ones are only offered). */
const FRESH_MS = 3000

export function useKeptCard(table: string, value: unknown, grid: ReturnType<typeof tableGrid>, write: (w: TableWrite[]) => void, root: RefObject<HTMLDivElement | null>) {
  const doc = useDocSelect((d) => d?._publishedId)
  const all = useTableKept(doc)
  const kept = useMemo(() => all.filter((k) => k.table === table), [all, table])
  const now = useRef({doc, kept, grid, value})
  now.current = {doc, kept, grid, value}
  const box = useRef<HTMLDivElement>(null)
  const followed = useRef(new Set<string>())
  const [lost, setLost] = useState<string | null>(null)
  // The cell the editor last went into (Put it back writes there when it was after the keep), and
  // what it held then (the caret moved on with its cell keeps it: that cell's text is the editor's own).
  const last = useRef<{row: string; column: number; at: number; start: string} | null>(null)
  useEffect(() => {
    const el = root.current
    const on = (e: FocusEvent) => {
      const input = e.target as HTMLInputElement
      const key = now.current.grid.rows[Number(input.dataset?.row)]?.key
      if (!input.matches?.('input.table-cell') || key === undefined) return
      const was = last.current
      last.current = {row: key, column: Number(input.dataset.column), at: Date.now(), start: was && typed.current?.row === key && was.row === key ? was.start : input.value}
    }
    el?.addEventListener('focusin', on)
    return () => el?.removeEventListener('focusin', on)
  })
  // At once when the card is drawn (TableInput's layout effect runs after it): a key typed in the
  // frame after would land in the cell, which now holds the other editor's text.
  const focusKept = (id: string) => {
    followed.current.add(id)
    const go = () => {
      const input = box.current?.querySelector<HTMLInputElement>(`[data-kept-id="${id}"] input`)
      input?.focus()
      input?.setSelectionRange(input.value.length, input.value.length)
      return !!input
    }
    if (!go()) requestAnimationFrame(go)
  }
  const fresh = (k: KeptText) => Date.now() - k.at < FRESH_MS
  /** A kept text of the cell the editor is in: only what was typed since it went in (lib/table-keep.ts typedSince). */
  const since = (row: string, text: string) => (last.current?.row === row ? typedSince(text, last.current.start, now.current.grid.rows.find((r) => r.key === row)?.cells ?? []) : text)
  /** A key that reached a cell's input whose text was just kept (before the card took the caret): onto the kept text. True: taken. */
  // The cell this editor typed in last (since it went into it).
  const typed = useRef<{row: string; column: number} | null>(null)
  const capture = useCallback((row: number, column: number, text: string, was: string) => {
    const {doc, kept, grid} = now.current
    const key = grid.rows[row]?.key
    if (key !== undefined) typed.current = {row: key, column}
    const k = was !== '' && kept.find((k) => k.row === key && k.column === column && k.text === was && fresh(k))
    if (!k || !doc) return false
    setKeptText(doc, k.id, since(k.row, text))
    focusKept(k.id)
    return true
  }, [])
  /** A key the table could not place (setCell's `refused`): the input's text to the card; the next drawing's follow takes the caret there. */
  const refuse = useCallback((row: number, column: number, text: string) => {
    const {doc, grid} = now.current
    const key = grid.rows[row]?.key
    if (doc && key !== undefined && text) keepTyped(doc, {table, row: key, column, text, at: Date.now()})
  }, [table])
  /** TableInput's caret, as a drawing starts: when its own text was just kept, the caret goes to the card. True: it went. */
  const follow = (held: {key: string; column: number; text?: string}) => {
    const text = held.text
    const k = text && kept.find((k) => !followed.current.has(k.id) && fresh(k) && k.row === held.key && k.column === held.column && (k.text.startsWith(text) || text.startsWith(k.text)))
    if (!k || !doc) return false
    const own = since(k.row, k.text)
    if (own !== k.text) setKeptText(doc, k.id, own)
    focusKept(k.id)
    return true
  }
  /** The caret's cell was removed by the other editor: what was typed in it goes to the card, and the caret with it. True: it went. */
  const lose = (held: {key: string; column: number; text?: string}) => {
    const t = typed.current
    if (!doc || !held.text || t?.row !== held.key || t.column !== held.column) return false
    typed.current = null
    focusKept(keepTyped(doc, {table, row: held.key, column: held.column, text: held.text, at: Date.now()}))
    return true
  }
  const putBack = (k: KeptText) => {
    const {doc, grid, value} = now.current
    const at = (key: string, column: number) => {
      const r = grid.rows.findIndex((x) => x.key === key)
      return r >= 0 && column < grid.columns ? ([r, column] as const) : null
    }
    // A cell that holds nothing, or the text's first keys (saved before the table changed).
    const fits = (cell: string) => cell === '' || k.text.startsWith(cell)
    const l = last.current
    const same = at(k.row, k.column)
    const to = (l && l.at > k.at && at(l.row, l.column)) || (same && fits(grid.rows[same[0]]!.cells[same[1]] ?? '') ? same : null)
    if (!to || !doc) return setLost(k.id)
    const cell = grid.rows[to[0]]!.cells[to[1]] ?? ''
    write(setCell(value, to[0], to[1], fits(cell) ? k.text : `${cell} ${k.text}`, newKey, cell))
    dropKept(doc, k.id)
    setLost(null)
  }
  return {doc, kept, box, lost, capture, refuse, follow, lose, putBack}
}

export function TableKeptCard({card}: {card: ReturnType<typeof useKeptCard>}) {
  const t = useT()
  const {doc, kept} = card
  if (!doc || !kept.length) return null
  return (
    <div className="pd-conflict table-kept" role="alert" ref={card.box} data-table-kept>
      <strong>{t('The table changed while you typed. Your text was kept:')}</strong>
      {kept.map((k) => (
        <div key={k.id} className="table-kept-row" data-kept-id={k.id}>
          <input className="input" value={k.text} aria-label={t('Kept text')} onChange={(e) => setKeptText(doc, k.id, e.target.value)} />
          <button type="button" className="btn-text" onClick={() => void navigator.clipboard?.writeText(k.text).catch(() => {})}>
            {t('Copy')}
          </button>
          <button type="button" className="btn-text" onClick={() => card.putBack(k)}>
            {t('Put it back')}
          </button>
          <button type="button" className="btn-text" onClick={() => dropKept(doc, k.id)}>
            {t('Dismiss')}
          </button>
          {card.lost === k.id && <span className="muted">{t('Click a cell in the table first.')}</span>}
        </div>
      ))}
    </div>
  )
}
