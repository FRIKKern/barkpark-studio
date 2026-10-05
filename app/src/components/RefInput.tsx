import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react'
import {keepPreviousData, useQuery} from '@tanstack/react-query'
import {docQuery, previewTitle, schemaOf, schemasQuery, searchQuery, type Doc} from '../lib/data'
import {ChevronDown, Close, Ellipsis} from './icons'
import {DocPreview, RefPreview} from './Preview'

type Props = {
  id: string
  refType: string
  value: string | undefined
  onChange: (v: string | undefined) => void
  linkFor: (id: string) => {href: string; selected: boolean; active: boolean}
}

/**
 * Sanity's reference input: a preview that opens the doc in the next pane, with a
 * "…" menu (Clear / Replace / Open in new tab); empty or replacing, a combobox
 * that searches the referenced type. Keyboard: arrows move, Enter picks, Esc cancels.
 */
export function RefInput({id, refType, value: outer, onChange, linkFor}: Props) {
  // Show a pick at once; the cache (and so `outer`) catches up a tick later.
  const [value, setValue] = useState(outer)
  const [seen, setSeen] = useState(outer)
  if (outer !== seen) {
    setSeen(outer)
    setValue(outer)
  }
  const [searching, setSearching] = useState(!value)
  const previewRef = useRef<HTMLDivElement>(null)
  const focusPreview = useRef(false)
  useEffect(() => setSearching(!outer), [outer])
  // Land on the new preview so Enter opens it (Sanity drops focus to <body>). Layout
  // effect: focus moves before the next key event, not a frame later.
  useLayoutEffect(() => {
    if (!focusPreview.current || searching) return
    focusPreview.current = false
    previewRef.current?.querySelector('a')?.focus()
  })
  const change = (v: string | undefined) => {
    setValue(v)
    setSearching(!v)
    onChange(v)
  }

  if (!searching && value)
    return (
      <div className="ref-box ref-row" ref={previewRef}>
        <div className="ref-preview">
          <RefPreview type={refType} id={value} {...linkFor(value)} />
        </div>
        <RefMenu
          onClear={() => change(undefined)}
          onReplace={() => setSearching(true)}
          newTabHref={`/structure/${refType};${value}`}
        />
      </div>
    )

  return (
    <RefSearch
      id={id}
      refType={refType}
      current={value}
      onPick={(picked) => {
        focusPreview.current = true
        change(picked)
      }}
      onCancel={value ? () => setSearching(false) : undefined}
    />
  )
}

function RefSearch({id, refType, current, onPick, onCancel}: {id: string; refType: string; current?: string; onPick: (id: string) => void; onCancel?: () => void}) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: currentDoc} = useQuery({...docQuery(refType, current ?? ''), enabled: !!current})
  const [q, setQ] = useState(() => (currentDoc ? previewTitle(currentDoc, schemaOf(schemas, refType)) : ''))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const {data: results = []} = useQuery({...searchQuery(refType, q.trim()), enabled: open, placeholderData: keepPreviousData})

  useEffect(() => {
    // Replacing: focus with the current title selected, so typing starts a new search.
    if (!onCancel) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [onCancel])

  const pick = (d: Doc | undefined) => d && onPick(d._publishedId)

  return (
    <div className="ref-search">
      <div className="combo">
        <input
          ref={inputRef}
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Type to search"
          autoComplete="off"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setOpen(true), setActive((a) => Math.min(a + 1, results.length - 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
            else if (e.key === 'Enter' && open) (e.preventDefault(), pick(results[active]))
            else if (e.key === 'Escape') (e.preventDefault(), open ? setOpen(false) : onCancel?.())
          }}
        />
        {onCancel && (
          <button type="button" className="icon-btn in-input" aria-label="Cancel" onClick={onCancel}>
            <Close />
          </button>
        )}
      </div>
      <button
        type="button"
        className="btn-square"
        aria-label="Show all"
        tabIndex={-1}
        onClick={() => {
          setQ('')
          setOpen(true)
          inputRef.current?.focus()
        }}
      >
        <ChevronDown />
      </button>
      {open && results.length > 0 && (
        <div className="popover options" role="listbox" id={listId}>
          {results.map((d, i) => (
            <div
              key={d._publishedId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(d))}
              onMouseEnter={() => setActive(i)}
            >
              <DocPreview doc={d} selected={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RefMenu({onClear, onReplace, newTabHref}: {onClear: () => void; onReplace: () => void; newTabHref: string}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const item = (label: string, run: () => void, cls = '') => (
    <button type="button" role="menuitem" className={`menu-item ${cls}`} onClick={() => (setOpen(false), run())}>
      {label}
    </button>
  )
  return (
    <div
      className="menu-wrap"
      ref={ref}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.key === 'Escape') setOpen(false)
        if (e.key === 'ArrowDown' && open) (e.preventDefault(), items[(i + 1) % items.length]?.focus())
        if (e.key === 'ArrowUp' && open) (e.preventDefault(), items[(i - 1 + items.length) % items.length]?.focus())
      }}
    >
      <button type="button" className="icon-btn" aria-label="Reference actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <div className="popover menu" role="menu">
          {item('Clear', onClear, 'danger')}
          {item('Replace', onReplace)}
          <hr />
          {item('Open in new tab', () => window.open(newTabHref, '_blank'))}
        </div>
      )}
    </div>
  )
}
