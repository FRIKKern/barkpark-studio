import {useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react'
import {useQuery} from '@tanstack/react-query'
import {codelistQuery, flatten, search, type Code, type Codelist} from '../lib/codelists'
import {CodeInput} from './NativeInputs'
import {useT} from '../lib/i18n'

// B05: a codelist field picks one code, as Barkpark's LiveView Studio does
// (components/fields/codelist_field.ex, tree_codelist_field.ex): a select for a short
// list (a tree's leaves with their breadcrumb), a search box over a long flat list,
// and a searchable tree for a long tree (Thema). The value is the code itself.

const SHORT = 100

type Props = {id: string; codelistId?: string; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}

export function CodelistInput(props: Props) {
  const t = useT()
  const {id, codelistId} = props
  const q = useQuery({...codelistQuery(codelistId ?? ''), enabled: !!codelistId})
  if (!codelistId || q.data === null)
    return (
      <select id={id} className="input" disabled>
        <option>{t('(no codelist registered: {id})', {id: codelistId ?? 'none'})}</option>
      </select>
    )
  // Unreadable for now: the code as text, still editable.
  if (q.isError) return <CodeInput {...props} />
  if (!q.data)
    return (
      <select id={id} className="input" disabled aria-busy="true">
        <option>{typeof props.value === 'string' ? t('{code} (loading the list…)', {code: props.value}) : t('Loading the list…')}</option>
      </select>
    )
  return <Picker {...props} list={q.data} />
}

function Picker({id, value, onChange, readOnly, list}: Props & {list: Codelist}) {
  const t = useT()
  const all = useMemo(() => flatten(list.values), [list])
  const tree = list.values.some((v) => v.children.length > 0)
  const code = typeof value === 'string' ? value : ''
  const current = code ? all.find((c) => c.code.value === code) : undefined
  if (all.length <= SHORT) {
    const options = tree ? all.filter((c) => c.code.children.length === 0) : all
    return (
      <select id={id} className="input" value={code} disabled={readOnly} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{t('— Select —')}</option>
        {code && !current && <option value={code}>{t('{code} (not in the list)', {code})}</option>}
        {options.map(({code: c, path}) => (
          <option key={c.value} value={c.value}>
            {c.value} — {[...path.map((p) => p.label), c.label].join(' › ')}
          </option>
        ))}
      </select>
    )
  }
  if (!tree) return <FlatSearch id={id} code={code} label={current?.code.label} list={list} onChange={onChange} readOnly={readOnly} />
  return <TreePicker id={id} code={code} current={current} all={all} list={list} onChange={onChange} readOnly={readOnly} />
}

/** A long flat list: type a code or a label, the browser offers matches (LiveView's datalist). */
function FlatSearch({id, code, label, list, onChange, readOnly}: {id: string; code: string; label?: string; list: Codelist; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const t = useT()
  const [text, setText] = useState(code)
  const [seen, setSeen] = useState(code)
  if (code !== seen) (setSeen(code), setText(code))
  return (
    <div className="codelist-flat">
      <input
        id={id}
        className="input mono"
        list={`${id}-codes`}
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={t('Search {list}…', {list: list.codelistId})}
        onChange={(e) => {
          const v = e.target.value.replace(/\s/g, '')
          setText(v)
          onChange(v || undefined)
        }}
      />
      <datalist id={`${id}-codes`}>
        {list.values.map((c) => (
          <option key={c.value} value={c.value} label={c.label} />
        ))}
      </datalist>
      {code && <span className={label ? 'codelist-label' : 'codelist-label invalid'}>{label ?? t('Not in the list')}</span>}
    </div>
  )
}

type Row = {code: Code; path: Code[]; level: number; open: boolean}

/** A long tree (Thema): search codes or labels, or open branches; any code can be chosen. */
function TreePicker({id, code, current, all, list, onChange, readOnly}: {id: string; code: string; current?: {code: Code; path: Code[]}; all: {code: Code; path: Code[]}[]; list: Codelist; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200)
    return () => clearTimeout(t)
  }, [query])
  // Open on the current value's branch, as Barkpark's Studio does.
  const [opened, setOpened] = useState(() => new Set(current?.path.map((p) => p.value) ?? []))
  const hits = useMemo(() => search(all, debounced), [all, debounced])
  const rows = useMemo<Row[]>(() => {
    if (debounced.trim()) {
      // Matches and their ancestors, all open.
      const show = new Set(hits.flatMap((h) => [...h.path, h.code].map((c) => c.value)))
      const walk = (codes: Code[], path: Code[]): Row[] =>
        codes.filter((c) => show.has(c.value)).flatMap((c) => [{code: c, path, level: path.length + 1, open: true}, ...walk(c.children, [...path, c])])
      return walk(list.values, [])
    }
    const walk = (codes: Code[], path: Code[]): Row[] =>
      codes.flatMap((c) => {
        const open = opened.has(c.value)
        return [{code: c, path, level: path.length + 1, open}, ...(open ? walk(c.children, [...path, c]) : [])]
      })
    return walk(list.values, [])
  }, [debounced, hits, opened, list])
  const toggle = (c: Code, open?: boolean) =>
    setOpened((s) => {
      const next = new Set(s)
      if (open ?? !next.has(c.value)) next.add(c.value)
      else next.delete(c.value)
      return next
    })
  const choose = (c: Code) => !readOnly && onChange(c.value)

  // Roving focus over the visible rows (WAI-ARIA tree): one row is tabbable.
  const [active, setActive] = useState(0)
  const at = Math.min(active, Math.max(rows.length - 1, 0))
  const items = useRef<(HTMLLIElement | null)[]>([])
  const move = (i: number) => {
    const n = Math.max(0, Math.min(rows.length - 1, i))
    setActive(n)
    items.current[n]?.focus()
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    const row = rows[i]!
    const branch = row.code.children.length > 0
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(i + 1),
      ArrowUp: () => move(i - 1),
      Home: () => move(0),
      End: () => move(rows.length - 1),
      ArrowRight: () => (branch && !row.open && !debounced.trim() ? toggle(row.code, true) : branch && move(i + 1)),
      ArrowLeft: () => {
        if (branch && row.open && !debounced.trim()) return toggle(row.code, false)
        const parent = row.path.at(-1)
        if (parent) move(rows.findIndex((r) => r.code === parent))
      },
      Enter: () => choose(row.code),
      ' ': () => choose(row.code),
    }
    const run = keys[e.key]
    if (run) (e.preventDefault(), run())
  }

  const label = current ? [...current.path.map((p) => p.label), current.code.label].join(' › ') : undefined
  return (
    <div className="codelist-tree-field">
      {code && (
        <div className="codelist-current">
          <span className="mono">{code}</span>
          <span className={label ? 'codelist-label' : 'codelist-label invalid'}>{label ?? t('Not in the list')}</span>
          {!readOnly && (
            <button type="button" className="icon-btn" aria-label={t('Remove code')} onClick={() => onChange(undefined)}>
              ×
            </button>
          )}
        </div>
      )}
      <div className="codelist-search">
        <input
          id={id}
          className="input"
          type="search"
          placeholder={t('Search codes or labels…')}
          aria-controls={`${id}-tree`} value={query}
          onChange={(e) => (setQuery(e.target.value), setActive(0))}
          // Down arrow goes into the list, as from a combobox.
          onKeyDown={(e) => e.key === 'ArrowDown' && rows.length > 0 && (e.preventDefault(), move(0))}
        />
        {query && (
          <button type="button" className="btn" onClick={() => (setQuery(''), setDebounced(''))}>
            {t('Clear')}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="muted codelist-empty">{debounced.trim() ? t('No matches for "{query}".', {query: debounced.trim()}) : t('No entries.')}</p>
      ) : (
        <ul id={`${id}-tree`} className="codelist-tree" role="tree" aria-label={list.name}>
          {rows.map((r, i) => {
            const branch = r.code.children.length > 0
            return (
              <li
                key={`${r.path.map((p) => p.value).join('/')}/${r.code.value}`}
                ref={(el) => void (items.current[i] = el)}
                role="treeitem"
                aria-level={r.level}
                aria-expanded={branch ? r.open : undefined}
                aria-selected={r.code.value === code}
                tabIndex={i === at ? 0 : -1}
                style={{paddingLeft: 4 + (r.level - 1) * 16}}
                onFocus={() => setActive(i)}
                onKeyDown={(e) => onKey(e, i)}
                onClick={() => (setActive(i), choose(r.code))}
              >
                <span
                  className="codelist-toggle"
                  aria-hidden="true"
                  onClick={(e) => {
                    if (!branch || debounced.trim()) return
                    e.stopPropagation()
                    toggle(r.code)
                  }}
                >
                  {branch ? (r.open ? '▼' : '▶') : ''}
                </span>
                <span className="mono">{r.code.value}</span> <span>{r.code.label}</span>
              </li>
            )
          })}
        </ul>
      )}
      {debounced.trim() && hits.length === 200 && <p className="muted codelist-empty">{t('The first 200 matches. Type more to narrow them.')}</p>}
    </div>
  )
}
