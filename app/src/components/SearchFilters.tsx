import {Fragment, useEffect, useId, useRef, useState, type ReactNode} from 'react'
import {useQuery} from '@tanstack/react-query'
import {searchQuery, type Schema} from '../lib/data'
import {intlTag, useLocale, useT, type T} from '../lib/i18n'
import {useFocusScope} from '../lib/focus-scope'
import {
  english,
  fieldTitle,
  filterLabel,
  filterMenu,
  isComplete,
  isCount,
  newFilter,
  operatorsFor,
  OPS,
  type FilterField,
  type Kind,
  type OpName,
  type SearchFilter,
  type Unit,
} from '../lib/search-filters'
import {Add, Calendar, ListIcon, Check, ChevronDown, Close, DocumentIcon, ImageIcon, LinkIcon, Search as SearchIcon, Sort, Trash} from './icons'

// J38, Sanity's search filters, side by side with sanity 6.17: the type picker
// ("All types", or the picked types as "Author, Post"), one chip per field filter
// (click: field, operator, value; ×: remove), "Add filter", "Clear filters", and
// the order row. The model (fields, operators, query) is lib/search-filters.ts.

export type SearchSort = 'best' | 'createdAsc' | 'createdDesc' | 'updatedAsc' | 'updatedDesc'
// Groups split by a divider, as Sanity's menu.
export const SORTS: [SearchSort, string][][] = [
  [['best', 'Best match']],
  [['createdAsc', 'Created: Oldest first'], ['createdDesc', 'Created: Newest first']],
  [['updatedAsc', 'Updated: Oldest first'], ['updatedDesc', 'Updated: Newest first']],
]
export const sortLabel = (s: SearchSort, t: T = english) => t(SORTS.flat().find(([k]) => k === s)![1])

/** Picked type titles, A–Z, cut to `chars` with "+N more" (Sanity's documentTypesTruncated). */
export function typesLabel(schemas: Schema[], types: string[], t: T = english, chars = 40) {
  if (!types.length) return t('All types')
  const titles = types.map((t) => schemas.find((s) => s.name === t)?.title ?? t).sort((a, b) => a.localeCompare(b))
  const shown: string[] = []
  for (const t of titles) if (!shown.length || [...shown, t].join(', ').length <= chars) shown.push(t)
    else break
  const more = titles.length - shown.length
  return more ? t('{types} +{count} more', {types: shown.join(', '), count: more}) : shown.join(', ')
}

const ICON: Record<Kind, () => ReactNode> = {
  string: () => <span className="glyph">Aa</span>,
  select: () => <ChevronDown />,
  number: () => <span className="glyph">123</span>,
  boolean: () => <Check />,
  date: () => <Calendar />,
  datetime: () => <Calendar />,
  reference: () => <LinkIcon />,
  array: () => <ListIcon />,
  arrayRef: () => <ListIcon />,
  presence: () => <DocumentIcon />,
}
const fieldIcon = (f: FilterField) => (f.path === 'image' || f.path === 'mainImage' ? <ImageIcon /> : ICON[f.kind]())


/** Close a popover on a press outside its menu-wrap (its button included), Sanity's click-outside. */
function useOutside(onClose: () => void) {
  const node = useRef<HTMLDivElement | null>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const wrap = node.current?.parentElement
      if (wrap && !wrap.contains(e.target as Node)) close.current()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [])
  return node
}

type Item = {key: string; label: ReactNode; text: string; checked?: boolean; onPick: () => void}
type Group = {title?: string; items: Item[]}

/**
 * A command popover, Sanity's: a "Filter" box keeps the caret, arrows move the
 * active row, Enter picks it, Escape or a click outside closes it.
 */
function CommandPopover({groups, find, onFind, onClose, label, footer, className = ''}: {
  groups: Group[]
  find: string
  onFind: (s: string) => void
  onClose: () => void
  label: string
  footer?: ReactNode
  className?: string
}) {
  const t = useT()
  const scope = useFocusScope<HTMLDivElement>({onDismiss: onClose})
  const outside = useOutside(onClose)
  const items = groups.flatMap((g) => g.items)
  const [active, setActive] = useState(0)
  const id = useId()
  const at = Math.min(active, items.length - 1)
  return (
    <div ref={(el) => ((outside.current = el), scope(el))} className={`popover command ${className}`}>
      <div className="command-find">
        <SearchIcon />
        <input
          autoFocus
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={items.length ? id : undefined}
          aria-label={label}
          aria-activedescendant={items.length ? `${id}-${at}` : undefined}
          placeholder={t('Filter')}
          value={find}
          onChange={(e) => (onFind(e.target.value), setActive(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive(Math.min(at + 1, items.length - 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive(Math.max(at - 1, 0)))
            else if (e.key === 'Enter') (e.preventDefault(), items[at]?.onPick())
          }}
        />
        {find && (
          <button type="button" className="icon-btn" aria-label={t('Clear')} tabIndex={-1} onClick={() => onFind('')}>
            <Close />
          </button>
        )}
      </div>
      <div className="command-list">
        {items.length > 0 && (
        <div role="listbox" id={id} aria-label={label}>
        {groups.map((g, gi) => (
          <Fragment key={g.title ?? gi}>
            {g.title && <p className="command-header">{g.title}</p>}
            {g.items.map((it) => {
              const i = items.indexOf(it)
              return (
                <div
                  key={it.key}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === at}
                  aria-checked={it.checked}
                  className="command-item"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => (e.preventDefault(), it.onPick())}
                >
                  {it.label}
                  {it.checked && <Check />}
                </div>
              )
            })}
          </Fragment>
        ))}
        </div>
        )}
        {!items.length && <p className="command-empty">{t('No matches for {filter}', {filter: find})}</p>}
      </div>
      {footer}
    </div>
  )
}

type Props = {
  schemas: Schema[]
  fields: Map<string, FilterField>
  types: string[]
  onTypes: (types: string[]) => void
  filters: SearchFilter[]
  onFilters: (filters: SearchFilter[]) => void
}

export function SearchFilters({schemas, fields, types, onTypes, filters, onFilters}: Props) {
  const t = useT()
  const [menu, setMenu] = useState<'types' | 'add' | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const typesBtn = useRef<HTMLButtonElement>(null)
  const addBtn = useRef<HTMLButtonElement>(null)
  const open = (m: 'types' | 'add') => (setFind(''), setMenu(menu === m ? null : m))
  const toggle = (name: string) => onTypes(types.includes(name) ? types.filter((t) => t !== name) : [...types, name])
  const sorted = [...schemas].sort((a, b) => a.title.localeCompare(b.title))
  const typeItems: Item[] = sorted
    .filter((s) => s.title.toLowerCase().includes(find.trim().toLowerCase()))
    .map((s) => ({key: s.name, text: s.title, label: <span>{s.title}</span>, checked: types.includes(s.name), onPick: () => toggle(s.name)}))
  const addGroups: Group[] = filterMenu(schemas, types, find, t).map((sec) => ({
    title: sec.title,
    items: sec.fields.map((f) => ({
      key: `${sec.title ?? ''}:${f.key}`,
      text: fieldTitle(f, t),
      label: (
        <span className={`field-choice${f.builtin ? ' builtin' : ''}`}>
          <span className="field-icon">{fieldIcon(f)}</span>
          <span>
            {f.parent && <small>{f.parent}</small>}
            {fieldTitle(f, t)}
          </span>
        </span>
      ),
      onPick: () => {
        const nf = newFilter(f, crypto.randomUUID().slice(0, 8))
        onFilters([...filters, nf])
        setMenu(null)
        setEditing(nf.id)
      },
    })),
  }))
  return (
    <div className="search-filter-row">
      <div className="menu-wrap">
        <button ref={typesBtn} type="button" className={`chip-btn${types.length ? ' on' : ''}`} aria-expanded={menu === 'types'} onClick={() => open('types')}>
          {typesLabel(schemas, types, t)} <ChevronDown />
        </button>
        {menu === 'types' && (
          <CommandPopover
            label={t('Document types')}
            groups={[{items: typeItems}]}
            find={find}
            onFind={setFind}
            onClose={() => setMenu(null)}
            footer={
              types.length > 0 && (
                <div className="command-footer">
                  <button type="button" className="link-btn" aria-label={t('Clear checked filters')} onMouseDown={(e) => e.preventDefault()} onClick={() => onTypes([])}>
                    {t('Clear')}
                  </button>
                </div>
              )
            }
          />
        )}
      </div>
      {filters.map((f) => (
        <FilterChip
          key={f.id}
          filter={f}
          field={fields.get(f.field)}
          open={editing === f.id}
          onOpen={(o) => setEditing(o ? f.id : null)}
          onChange={(nf) => onFilters(filters.map((x) => (x.id === f.id ? nf : x)))}
          onRemove={() => (onFilters(filters.filter((x) => x.id !== f.id)), addBtn.current?.focus())}
        />
      ))}
      <div className="menu-wrap">
        <button ref={addBtn} type="button" className="chip-btn plain" aria-expanded={menu === 'add'} onClick={() => open('add')}>
          <Add /> {t('Add filter')}
        </button>
        {menu === 'add' && <CommandPopover label={t('Filters')} className="filter-menu" groups={addGroups} find={find} onFind={setFind} onClose={() => setMenu(null)} />}
      </div>
      {(types.length > 0 || filters.length > 0) && (
        <button type="button" className="link-btn danger clear-filters" onClick={() => (onTypes([]), onFilters([]), typesBtn.current?.focus())}>
          {t('Clear filters')}
        </button>
      )}
    </div>
  )
}

function FilterChip({filter, field, open, onOpen, onChange, onRemove}: {
  filter: SearchFilter
  field: FilterField | undefined
  open: boolean
  onOpen: (open: boolean) => void
  onChange: (f: SearchFilter) => void
  onRemove: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const l = filterLabel(filter, field, t, intlTag(locale))
  const text = [l.field, l.op, l.value].filter(Boolean).join(' ')
  return (
    <div className="menu-wrap">
      <span className={`filter-chip${isComplete(filter) ? ' set' : ''}`}>
        <button type="button" className="filter-chip-label" aria-label={text} aria-expanded={open} onClick={() => onOpen(!open)}>
          {l.field}
          {l.op && <span className="op"> {l.op} </span>}
          {l.value}
        </button>
        <button type="button" className="icon-btn" aria-label={t('Remove filter')} onClick={onRemove}>
          <Close />
        </button>
      </span>
      {open && field && <FilterEditor filter={filter} field={field} onChange={onChange} onClose={() => onOpen(false)} onRemove={onRemove} />}
    </div>
  )
}

function FilterEditor({filter, field, onChange, onClose, onRemove}: {filter: SearchFilter; field: FilterField; onChange: (f: SearchFilter) => void; onClose: () => void; onRemove: () => void}) {
  const t = useT()
  const scope = useFocusScope<HTMLDivElement>({onDismiss: onClose})
  const outside = useOutside(onClose)
  // The value box takes the caret when the editor opens (Sanity's), not the operator button.
  // Mount effects run after the closing menu hands focus back, so this one wins.
  useEffect(() => outside.current?.querySelector<HTMLElement>('.filter-editor-value :is(input, select)')?.focus(), [outside])
  const [ops, setOps] = useState(false)
  const groups = operatorsFor(field)
  const set = (patch: Partial<SearchFilter>) => onChange({...filter, ...patch})
  const pickOp = (op: OpName) => {
    setOps(false)
    if (op === filter.op) return
    onChange({id: filter.id, field: filter.field, op, ...(op === 'last' && {value: '7', unit: 'days' as const})})
  }
  return (
    <div ref={(el) => ((outside.current = el), scope(el))} className="popover filter-editor" role="dialog" aria-label={fieldTitle(field, t)}>
      <div className="filter-editor-head">
        <p className="filter-editor-field">
          <span className="field-icon">{fieldIcon(field)}</span>
          <span>
            {field.parent && <small>{field.parent}</small>}
            {fieldTitle(field, t)}
          </span>
          {/* Phone width: the chip has no ×, so the editor carries the remove. */}
          <button type="button" className="icon-btn filter-trash" aria-label={t('Remove filter')} onClick={onRemove}>
            <Trash />
          </button>
        </p>
        {groups.flat().length > 1 && (
          <div className="menu-wrap">
            <button type="button" className="chip-btn" aria-haspopup="menu" aria-expanded={ops} onClick={() => setOps(!ops)}>
              {t(OPS[filter.op].name)} <ChevronDown />
            </button>
            {ops && <OperatorMenu groups={groups} op={filter.op} onPick={pickOp} onClose={() => setOps(false)} />}
          </div>
        )}
      </div>
      {filter.op !== 'defined' && filter.op !== 'notDefined' && (
        <div className="filter-editor-value">
          <ValueInput filter={filter} field={field} set={set} />
        </div>
      )}
    </div>
  )
}

function OperatorMenu({groups, op, onPick, onClose}: {groups: OpName[][]; op: OpName; onPick: (op: OpName) => void; onClose: () => void}) {
  const t = useT()
  const scope = useFocusScope<HTMLDivElement>({menu: true, onDismiss: onClose})
  const outside = useOutside(onClose)
  return (
    <div ref={(el) => ((outside.current = el), scope(el))} className="popover menu op-menu" role="menu">
      {groups.map((g, i) => (
        <Fragment key={i}>
          {i > 0 && <hr />}
          {g.map((o) => (
            <button key={o} type="button" role="menuitemradio" aria-checked={o === op} className="menu-item" onClick={() => onPick(o)}>
              {t(OPS[o].name)}
              {OPS[o].symbol && <kbd>{OPS[o].symbol}</kbd>}
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  )
}

function ValueInput({filter, field, set}: {filter: SearchFilter; field: FilterField; set: (p: Partial<SearchFilter>) => void}) {
  const t = useT()
  const {op, kind} = {op: filter.op, kind: field.kind}
  if (op === 'last')
    return (
      <div className="filter-pair">
        <input className="input" type="number" min={1} aria-label={t('Unit value')} autoFocus value={filter.value ?? ''} onChange={(e) => set({value: e.target.value})} />
        <select className="input" aria-label={t('Select unit')} value={filter.unit ?? 'days'} onChange={(e) => set({unit: e.target.value as Unit})}>
          <option value="days">{t('Days')}</option>
          <option value="months">{t('Months')}</option>
          <option value="years">{t('Years')}</option>
        </select>
      </div>
    )
  if (kind === 'reference' || op === 'includes' || op === 'notIncludes') return <ReferenceValue filter={filter} field={field} set={set} />
  if (op === 'countRange')
    return (
      <div className="filter-pair">
        <input className="input" type="number" min={0} autoFocus aria-label={t('Min value')} placeholder={t('Min value')} value={filter.value ?? ''} onChange={(e) => set({value: e.target.value})} />
        <input className="input" type="number" min={0} aria-label={t('Max value')} placeholder={t('Max value')} value={filter.to ?? ''} onChange={(e) => set({to: e.target.value})} />
      </div>
    )
  if (isCount(op))
    return <input className="input" type="number" min={0} autoFocus aria-label={t('Value')} placeholder={t('Value')} value={filter.value ?? ''} onChange={(e) => set({value: e.target.value})} />
  if (kind === 'boolean')
    return (
      <select className="input" aria-label={t('Value')} autoFocus value={filter.value ?? ''} onChange={(e) => set({value: e.target.value})}>
        <option value="" disabled>{t('Select…')}</option>
        <option value="true">{t('True')}</option>
        <option value="false">{t('False')}</option>
      </select>
    )
  if (kind === 'select' && (op === 'eq' || op === 'neq'))
    return (
      <select className="input" aria-label={t('Value')} autoFocus value={filter.value ?? ''} onChange={(e) => set({value: e.target.value})}>
        <option value="" disabled>{t('Select…')}</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.title}
          </option>
        ))}
      </select>
    )
  const type = kind === 'number' ? 'number' : kind === 'date' ? 'date' : kind === 'datetime' ? (op === 'eq' ? 'date' : 'datetime-local') : 'text'
  if (op === 'range') {
    const dates = kind === 'date' || kind === 'datetime'
    return (
      <div className="filter-pair">
        <input className="input" type={type} autoFocus aria-label={t(dates ? 'Start date' : 'Min value')} placeholder={dates ? undefined : t('Min value')} value={filter.value ?? ''} onChange={(e) => set({value: e.target.value})} />
        <input className="input" type={type} aria-label={t(dates ? 'End date' : 'Max value')} placeholder={dates ? undefined : t('Max value')} value={filter.to ?? ''} onChange={(e) => set({to: e.target.value})} />
      </div>
    )
  }
  return (
    <input
      className="input"
      type={type}
      autoFocus
      aria-label={t(type === 'date' || type === 'datetime-local' ? 'Date' : 'Value')}
      placeholder={type === 'text' || type === 'number' ? t('Value') : undefined}
      value={filter.value ?? ''}
      onChange={(e) => set({value: e.target.value})}
    />
  )
}

function ReferenceValue({filter, field, set}: {filter: SearchFilter; field: FilterField; set: (p: Partial<SearchFilter>) => void}) {
  const t = useT()
  const [q, setQ] = useState('')
  const found = useQuery({...searchQuery(field.refTypes ?? [], q.trim()), enabled: !filter.value})
  if (filter.value)
    return (
      <div className="filter-pair">
        <span className="filter-ref">{filter.label ?? filter.value}</span>
        <button type="button" className="btn" onClick={() => set({value: undefined, label: undefined})}>
          {t('Clear')}
        </button>
      </div>
    )
  return (
    <div className="filter-ref-search">
      <input className="input" autoFocus aria-label={t('Value')} placeholder={t('Search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="filter-ref-results">
        {(found.data ?? []).slice(0, 8).map((d) => (
          <button key={d._id} type="button" className="menu-item" onClick={() => set({value: d._publishedId, label: String(d.title ?? d._publishedId)})}>
            {String(d.title ?? d._publishedId)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SearchOrdering({sort, onSort}: {sort: SearchSort; onSort: (s: SearchSort) => void}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="search-order">
      <div className="menu-wrap">
        <button type="button" className="chip-btn plain" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Sort /> {sortLabel(sort, t)}
        </button>
        {open && <SortMenu sort={sort} onPick={(s) => (onSort(s), setOpen(false))} onClose={() => setOpen(false)} />}
      </div>
    </div>
  )
}

function SortMenu({sort, onPick, onClose}: {sort: SearchSort; onPick: (s: SearchSort) => void; onClose: () => void}) {
  const t = useT()
  const scope = useFocusScope<HTMLDivElement>({menu: true, onDismiss: onClose})
  const outside = useOutside(onClose)
  return (
    <div ref={(el) => ((outside.current = el), scope(el))} className="popover menu" role="menu">
      {SORTS.map((g, i) => (
        <Fragment key={i}>
          {i > 0 && <hr />}
          {g.map(([k, label]) => (
            <button key={k} type="button" role="menuitemradio" aria-checked={sort === k} className="menu-item" onClick={() => onPick(k)}>
              {t(label)}
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  )
}
