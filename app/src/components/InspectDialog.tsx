import {useEffect, useRef, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {getPref, putPref} from '../lib/prefs'
import {DialogBox} from './FocusScopes'
import type {Doc} from '../lib/data'
import {Close as CloseIcon, Search as SearchIcon} from './icons'
import {useT, type T} from '../lib/i18n'

// Sanity's Inspect (J28, Ctrl+Alt+I or the header "…" menu): the document as
// stored, over its own pane. "Parsed" is a collapsible tree with a filter, "Raw
// JSON" the text. Client-only bookkeeping (_hasPublished, _publishedAt) is left out.

type Json = null | boolean | number | string | Json[] | {[k: string]: Json}

// Sanity reopens Inspect on the view used last, also after a reload and in another browser:
// it keeps it per user on its server. So does this, through lib/prefs (Barkpark, per editor),
// mirrored here in localStorage for the first paint (task-d381604895f6d274), like studio.lists.
const VIEW_KEY = 'studio.inspect.view'
const viewPrefQuery = {queryKey: ['pref', VIEW_KEY], queryFn: async () => ((await getPref({data: VIEW_KEY}).catch(() => null)) as {view?: unknown} | null)?.view ?? null, staleTime: 60_000}
const readView = (): 'parsed' | 'raw' => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'raw' ? 'raw' : 'parsed'
  } catch {
    return 'parsed'
  }
}
const mirrorView = (view: 'parsed' | 'raw') => {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {}
}
// Barkpark keeps a JSON object per key (a bare string is refused), so the view rides as {view}.
const keepView = (view: 'parsed' | 'raw') => (mirrorView(view), void putPref({data: {key: VIEW_KEY, value: {view}}}).catch(() => {}))

/** The document as stored, keys in order (Sanity's): client-only bookkeeping (_hasPublished, _publishedAt) left out. */
export function storedValue(doc: Doc): Json {
  const {_hasPublished, _publishedAt, ...stored} = doc
  void _hasPublished
  void _publishedAt
  return Object.fromEntries(Object.entries(stored).sort(([a], [b]) => a.localeCompare(b))) as Json
}

export function InspectDialog({doc, title, onClose}: {doc: Doc; title: string; onClose: () => void}) {
  const t = useT()
  const [tab, setTabState] = useState<'parsed' | 'raw'>(readView)
  const chosen = useRef(false)
  const qc = useQueryClient()
  const setTab = (next: 'parsed' | 'raw') => ((chosen.current = true), keepView(next), qc.setQueryData(viewPrefQuery.queryKey, next), setTabState(next))
  // The editor's own choice from Barkpark (another browser's), unless they chose here already.
  const {data: kept} = useQuery(viewPrefQuery)
  useEffect(() => {
    if (chosen.current || (kept !== 'raw' && kept !== 'parsed')) return
    mirrorView(kept)
    setTabState(kept)
  }, [kept])
  const [query, setQuery] = useState('')
  const value = storedValue(doc)
  return (
    <div className="dialog-backdrop inspect-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog inspect" aria-modal="true" aria-label={t('Inspecting {title}', {title})} onClose={onClose}>
        <header>
          <h2>
            {t('Inspecting')} <em>{title}</em>
          </h2>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} autoFocus onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="view-tabs inspect-tabs" role="tablist" aria-label={t('Inspect views')}>
          <button type="button" role="tab" aria-selected={tab === 'parsed'} onClick={() => setTab('parsed')}>
            {t('Parsed')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'raw'} onClick={() => setTab('raw')}>
            {t('Raw JSON')}
          </button>
        </div>
        <div className="dialog-body inspect-body">
          {tab === 'parsed' ? (
            <>
              <label className="inspect-search">
                <SearchIcon />
                <input className="input" placeholder={t('Search')} aria-label={t('Search')} value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <ul className="json-tree" role="tree">
                <Node value={value} query={query.trim().toLowerCase()} />
              </ul>
            </>
          ) : (
            <pre className="json-raw">{jsonTokens(JSON.stringify(value, null, 2)).map(([kind, text], i) => (kind ? <span key={i} className={`syntax-${kind}`}>{text}</span> : text))}</pre>
          )}
        </div>
      </DialogBox>
    </div>
  )
}

// Raw JSON in Sanity's syntax colours (its Prism tokens): property, operator, string,
// number / boolean / null, punctuation. Whitespace stays plain text.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)|([{}[\],])/g
type Token = [kind: 'property' | 'operator' | 'string' | 'constant' | 'punctuation' | null, text: string]
function jsonTokens(text: string): Token[] {
  const out: Token[] = []
  let at = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > at) out.push([null, text.slice(at, m.index)])
    if (m[1] && m[2]) out.push(['property', m[1]], [null, m[2].slice(0, -1)], ['operator', ':'])
    else if (m[1]) out.push(['string', m[1]])
    else if (m[3]) out.push(['constant', m[3]])
    else out.push(['punctuation', m[4]!])
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push([null, text.slice(at)])
  return out
}

const isBranch = (v: Json): v is Json[] | {[k: string]: Json} => v !== null && typeof v === 'object'
const entries = (v: Json[] | {[k: string]: Json}) => (Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v))
/** "{…} 9 properties": under a filter, of what it shows (Sanity's). */
const summary = (v: Json[] | {[k: string]: Json}, t: T, q: string) => {
  const n = entries(v).filter(([k, x]) => matches(k, x, q)).length
  if (Array.isArray(v)) return `[…] ${n === 1 ? t('1 item') : t('{n} items', {n})}`
  return `{…} ${n === 1 ? t('1 property') : t('{n} properties', {n})}`
}
/** Does the key or anything under it match the filter? */
const matches = (key: string, v: Json, q: string): boolean =>
  !q || key.toLowerCase().includes(q) || (isBranch(v) ? entries(v).some(([k, x]) => matches(k, x, q)) : String(v).toLowerCase().includes(q))

// Every branch starts open, as in Sanity.
function Node({name, value, query}: {name?: string; value: Json; query: string}) {
  const t = useT()
  const [open, setOpen] = useState(true)
  if (name !== undefined && !matches(name, value, query)) return null
  const key = name !== undefined && <span className="json-key">{name}:</span>
  if (!isBranch(value))
    return (
      <li role="treeitem">
        {key} <span className="json-value" data-type={value === null ? 'null' : typeof value}>{value === null ? 'null' : String(value)}</span>
      </li>
    )
  // A filter opens every branch that holds a match.
  const expanded = open || !!query
  return (
    <li role="treeitem" aria-expanded={expanded}>
      <button type="button" className="json-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="json-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        {key} <span className="json-summary">{summary(value, t, query)}</span>
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
