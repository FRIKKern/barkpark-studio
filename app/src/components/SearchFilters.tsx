import {Fragment, useState} from 'react'
import type {Field, RefFilter, Schema} from '../lib/data'
import {MenuPopover} from './FocusScopes'
import {Add, ChevronDown, Close} from './icons'

// J38, Sanity's search filters: a type picker ("All types" or the chosen types as
// chips), "Add filter" (edited / created after a date, and any text or date field
// of the types in play), and the order ("Best match", "Last edited", "Created").
// Filters run in Barkpark's query (filter[field][op]); a field filter only asks the
// types that have that field.

export type SearchFilter = {id: string; label: string; field: string; op: 'contains' | 'gte'; kind: 'text' | 'date'; value: string}
export type SearchSort = 'best' | 'edited' | 'created'
export const SORTS: [SearchSort, string][] = [
  ['best', 'Best match'],
  ['edited', 'Last edited'],
  ['created', 'Created'],
]
const TEXT = new Set(['string', 'text', 'slug', 'email', 'url'])
const DATE = new Set(['datetime', 'date'])

/** The Barkpark filter for one type: only the filters that type can answer (null: skip the type). */
export function filterFor(schema: Schema, filters: SearchFilter[]): RefFilter | null {
  const out: RefFilter = {}
  for (const f of filters) {
    if (!f.value) continue
    if (!f.field.startsWith('_') && !schema.fields.some((x) => x.name === f.field)) return null
    const value = f.kind === 'date' ? new Date(f.value).toISOString() : f.value
    out[f.field] = {...out[f.field], [f.op]: value}
  }
  return out
}

/** What "Add filter" offers for these types: the doc dates, then their text and date fields. */
function choices(schemas: Schema[]): Omit<SearchFilter, 'id' | 'value'>[] {
  const fields = new Map<string, Field>()
  for (const s of schemas) for (const f of s.fields) if ((TEXT.has(f.type) || DATE.has(f.type)) && !fields.has(f.name)) fields.set(f.name, f)
  return [
    {label: 'Edited at', field: '_updatedAt', op: 'gte', kind: 'date'},
    {label: 'Created at', field: '_createdAt', op: 'gte', kind: 'date'},
    ...[...fields.values()]
      .sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name))
      .map((f) => ({label: f.title ?? f.name, field: f.name, op: DATE.has(f.type) ? ('gte' as const) : ('contains' as const), kind: DATE.has(f.type) ? ('date' as const) : ('text' as const)})),
  ]
}

type Props = {
  schemas: Schema[]
  types: string[]
  onTypes: (types: string[]) => void
  filters: SearchFilter[]
  onFilters: (filters: SearchFilter[]) => void
  sort: SearchSort
  onSort: (sort: SearchSort) => void
}

export function SearchFilters({schemas, types, onTypes, filters, onFilters, sort, onSort}: Props) {
  const [menu, setMenu] = useState<'types' | 'add' | 'sort' | null>(null)
  const [find, setFind] = useState('')
  const inPlay = types.length ? schemas.filter((s) => types.includes(s.name)) : schemas
  const toggle = (name: string) => onTypes(types.includes(name) ? types.filter((t) => t !== name) : [...types, name])
  const set = (id: string, value: string) => onFilters(filters.map((f) => (f.id === id ? {...f, value} : f)))
  return (
    <div className="search-filters">
      <div className="search-filter-row">
        <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(null)}>
          <button id="search-types" type="button" className="chip-btn" aria-haspopup="menu" aria-expanded={menu === 'types'} onClick={() => setMenu(menu === 'types' ? null : 'types')}>
            {types.length ? types.map((t) => schemas.find((s) => s.name === t)?.title ?? t).join(', ') : 'All types'} <ChevronDown />
          </button>
          {menu === 'types' && (
            <MenuPopover className="popover menu" onClose={() => setMenu(null)} aria-labelledby="search-types">
              {schemas.map((s) => (
                <button key={s.name} type="button" role="menuitemcheckbox" aria-checked={types.includes(s.name)} className="menu-item check" onClick={() => toggle(s.name)}>
                  {s.title}
                </button>
              ))}
              {types.length > 0 && (
                <button type="button" role="menuitem" className="menu-item" onClick={() => (onTypes([]), setMenu(null))}>
                  Clear
                </button>
              )}
            </MenuPopover>
          )}
        </div>
        {filters.map((f) => (
          <span key={f.id} className="filter-chip">
            <label htmlFor={`search-filter-${f.id}`}>
              {f.label} {f.kind === 'date' ? 'after' : 'contains'}
            </label>
            <input id={`search-filter-${f.id}`} type={f.kind === 'date' ? 'date' : 'text'} value={f.value} autoFocus onChange={(e) => set(f.id, e.target.value)} />
            <button type="button" className="icon-btn" aria-label={`Remove filter ${f.label}`} onClick={() => onFilters(filters.filter((x) => x.id !== f.id))}>
              <Close />
            </button>
          </span>
        ))}
        <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(null)}>
          <button id="search-add-filter" type="button" className="chip-btn" aria-haspopup="menu" aria-expanded={menu === 'add'} onClick={() => (setFind(''), setMenu(menu === 'add' ? null : 'add'))}>
            <Add /> Add filter
          </button>
          {menu === 'add' && (
            <MenuPopover className="popover menu filter-menu" onClose={() => setMenu(null)} aria-labelledby="search-add-filter">
              <input className="input filter-find" placeholder="Filter" aria-label="Filter the filters" autoFocus value={find} onChange={(e) => setFind(e.target.value)} />
              {choices(inPlay)
                .filter((c) => c.label.toLowerCase().includes(find.toLowerCase()))
                .map((c, i, all) => (
                  <Fragment key={c.field}>
                    {!c.field.startsWith('_') && (i === 0 || all[i - 1]!.field.startsWith('_')) && <p className="menu-label">All fields</p>}
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => (onFilters([...filters, {...c, id: crypto.randomUUID().slice(0, 8), value: ''}]), setMenu(null))}
                    >
                      {c.label}
                    </button>
                  </Fragment>
                ))}
            </MenuPopover>
          )}
        </div>
      </div>
      <div className="search-filter-row">
        <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(null)}>
          <button id="search-sort" type="button" className="chip-btn plain" aria-haspopup="menu" aria-expanded={menu === 'sort'} onClick={() => setMenu(menu === 'sort' ? null : 'sort')}>
            ⇅ {SORTS.find(([k]) => k === sort)![1]}
          </button>
          {menu === 'sort' && (
            <MenuPopover className="popover menu" onClose={() => setMenu(null)} aria-labelledby="search-sort">
              {SORTS.map(([k, label]) => (
                <button key={k} type="button" role="menuitemradio" aria-checked={sort === k} className="menu-item check" onClick={() => (onSort(k), setMenu(null))}>
                  {label}
                </button>
              ))}
            </MenuPopover>
          )}
        </div>
      </div>
    </div>
  )
}
