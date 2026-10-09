import {useEffect, useRef, useState, type KeyboardEvent} from 'react'
import {ChevronDown, ChevronUp, Close as CloseIcon} from './icons'
import {toast} from './Toasts'
import {useT} from '../lib/i18n'

// D19, after Barkdown's paper tab (app/renderer/src/tabs/paper.js): find and replace in
// the canvas. The canvas paints the matches and replaces in one transaction, so undo is
// one step and the save one batch (barkpark canvas/find-replace.js); the host draws the
// bar. Enter / Shift+Enter step through the matches; in Replace, Enter replaces the
// current one and Mod+Enter all of them; Escape closes and puts the caret back.

/** The canvas element's find surface (canvas/index.js). */
export type FindCanvas = HTMLElement & {
  findSet(query: string): FindState
  findNext(): FindState
  findPrev(): FindState
  findClear(): void
  findState(): FindState
  replaceCurrent(text: string): FindState
  replaceAll(text: string): FindState & {replaced: number}
}
type FindState = {count: number; index: number}

/** Ctrl/Cmd+F opens find; Ctrl+H (Cmd+H hides the browser on macOS) or Cmd+Alt+F opens it on Replace. */
export function findKey(e: {key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean}): 'find' | 'replace' | null {
  const key = e.key.toLowerCase()
  if (e.shiftKey) return null
  if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'f') return 'find'
  if (e.ctrlKey && !e.altKey && key === 'h') return 'replace'
  if (e.metaKey && e.altKey && (key === 'f' || e.key === 'ƒ')) return 'replace'
  return null
}

/** `opened` changes on every Ctrl/Cmd+F or +H, also while the bar is open: it takes the caret again. */
export function FindBar({canvas, opened, onClose, editable}: {canvas: () => FindCanvas | null; opened: {focus: 'find' | 'replace'; at: number}; onClose: () => void; editable: boolean}) {
  const t = useT()
  const [state, setState] = useState<FindState>({count: 0, index: -1})
  const [query, setQuery] = useState(() => {
    const sel = String(window.getSelection?.() ?? '').trim()
    return sel && !sel.includes('\n') ? sel : ''
  })
  const findRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const sync = (s?: FindState) => setState(s ?? canvas()?.findState() ?? {count: 0, index: -1})
  const search = (q: string) => (setQuery(q), sync(canvas()?.findSet(q)))
  const keys = (e: KeyboardEvent<HTMLElement>, enter: () => void) => {
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onClose())
    else if (e.key === 'Enter') (e.preventDefault(), enter())
  }
  const replaceAll = (text: string) => {
    const r = canvas()?.replaceAll(text)
    sync(r)
    if (r?.replaced) toast({title: t('Replaced {count}', {count: r.replaced}), key: 'find-replaced'})
  }
  // The selected words (one line) are what it looks for first.
  useEffect(() => sync(canvas()?.findSet(query)), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const input = opened.focus === 'replace' && editable ? replaceRef.current : findRef.current
    input?.focus()
    input?.select()
  }, [opened, editable])
  return (
    <div className="pd-find" role="search" aria-label={t('Find in document')}>
      <input
        ref={findRef}
        type="text"
        aria-label={t('Find')}
        placeholder={t('Find')}
        value={query}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => keys(e, () => sync(e.shiftKey ? canvas()?.findPrev() : canvas()?.findNext()))}
      />
      <span className="pd-find-count" aria-live="polite" data-empty={query && !state.count ? '' : undefined}>
        {state.count ? t('{n} of {count}', {n: state.index + 1, count: state.count}) : query ? t('No matches') : ''}
      </span>
      <button type="button" className="icon-btn" aria-label={t('Previous match')} data-tip={t('Previous match')} data-tip-keys="Shift Enter" disabled={!state.count} onClick={() => sync(canvas()?.findPrev())}>
        <ChevronUp />
      </button>
      <button type="button" className="icon-btn" aria-label={t('Next match')} data-tip={t('Next match')} data-tip-keys="Enter" disabled={!state.count} onClick={() => sync(canvas()?.findNext())}>
        <ChevronDown />
      </button>
      {editable && (
        <>
          <input
            ref={replaceRef}
            type="text"
            aria-label={t('Replace with')}
            placeholder={t('Replace with')}
            onKeyDown={(e) => keys(e, () => (e.ctrlKey || e.metaKey ? replaceAll(e.currentTarget.value) : sync(canvas()?.replaceCurrent(e.currentTarget.value))))}
          />
          <button type="button" className="btn" disabled={!state.count} onClick={() => sync(canvas()?.replaceCurrent(replaceRef.current?.value ?? ''))}>
            {t('Replace')}
          </button>
          <button type="button" className="btn" disabled={!state.count} onClick={() => replaceAll(replaceRef.current?.value ?? '')}>
            {t('Replace all')}
          </button>
        </>
      )}
      <button type="button" className="icon-btn" aria-label={t('Close find')} data-tip={t('Close find')} data-tip-keys="Esc" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  )
}
