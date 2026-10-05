import {useState} from 'react'
import type {Doc} from '../lib/data'
import {Close as CloseIcon, Search as SearchIcon} from './icons'

// Sanity's Inspect (J28, Ctrl+Alt+I or the header "…" menu): the document as
// stored, over its own pane. "Parsed" is a collapsible tree with a filter, "Raw
// JSON" the text. Client-only bookkeeping (_hasPublished) is left out.

type Json = null | boolean | number | string | Json[] | {[k: string]: Json}

export function InspectDialog({doc, title, onClose}: {doc: Doc; title: string; onClose: () => void}) {
  const [tab, setTab] = useState<'parsed' | 'raw'>('parsed')
  const [query, setQuery] = useState('')
  const {_hasPublished, ...stored} = doc
  void _hasPublished
  const value = Object.fromEntries(Object.entries(stored).sort(([a], [b]) => a.localeCompare(b))) as Json
  return (
    <div className="dialog-backdrop inspect-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog inspect" role="dialog" aria-modal="true" aria-label={`Inspecting ${title}`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header>
          <h2>
            Inspecting <em>{title}</em>
          </h2>
          <button type="button" className="icon-btn" aria-label="Close" autoFocus onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="view-tabs inspect-tabs" role="tablist" aria-label="Inspect views">
          <button type="button" role="tab" aria-selected={tab === 'parsed'} onClick={() => setTab('parsed')}>
            Parsed
          </button>
          <button type="button" role="tab" aria-selected={tab === 'raw'} onClick={() => setTab('raw')}>
            Raw JSON
          </button>
        </div>
        <div className="dialog-body inspect-body">
          {tab === 'parsed' ? (
            <>
              <label className="inspect-search">
                <SearchIcon />
                <input className="input" placeholder="Search" aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <ul className="json-tree" role="tree">
                <Node value={value} query={query.trim().toLowerCase()} />
              </ul>
            </>
          ) : (
            <pre className="json-raw">{JSON.stringify(value, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

const isBranch = (v: Json): v is Json[] | {[k: string]: Json} => v !== null && typeof v === 'object'
const entries = (v: Json[] | {[k: string]: Json}) => (Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v))
const summary = (v: Json[] | {[k: string]: Json}) =>
  Array.isArray(v) ? `[…] ${v.length} ${v.length === 1 ? 'item' : 'items'}` : `{…} ${Object.keys(v).length} ${Object.keys(v).length === 1 ? 'property' : 'properties'}`
/** Does the key or anything under it match the filter? */
const matches = (key: string, v: Json, q: string): boolean =>
  !q || key.toLowerCase().includes(q) || (isBranch(v) ? entries(v).some(([k, x]) => matches(k, x, q)) : String(v).toLowerCase().includes(q))

// Every branch starts open, as in Sanity.
function Node({name, value, query}: {name?: string; value: Json; query: string}) {
  const [open, setOpen] = useState(true)
  if (name !== undefined && !matches(name, value, query)) return null
  const key = name !== undefined && <span className="json-key">{name}:</span>
  if (!isBranch(value))
    return (
      <li role="treeitem">
        {key} <span className="json-value">{value === null ? 'null' : String(value)}</span>
      </li>
    )
  // A filter opens every branch that holds a match.
  const expanded = open || !!query
  return (
    <li role="treeitem" aria-expanded={expanded}>
      <button type="button" className="json-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="json-caret" data-open={expanded || undefined}>▸</span>
        {key} <span className="json-summary">{summary(value)}</span>
      </button>
      {expanded && (
        <ul role="group">
          {entries(value).map(([k, v]) => (
            <Node key={k} name={k} value={v} query={query} />
          ))}
        </ul>
      )}
    </li>
  )
}
