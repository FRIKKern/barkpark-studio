import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react'
import {useT} from '../lib/i18n'
import {LinkIcon} from './icons'

/**
 * Sanity Vision's result view: a JSON tree whose objects and arrays fold, each saying
 * how much it holds ("{…} 21 properties", "[…] 3 items"). Open to `open` levels deep,
 * as Vision opens a result.
 */
export function JsonTree({value, open = 3}: {value: unknown; open?: number}) {
  return (
    <ul className="json-tree" role="tree">
      <Node value={value} depth={0} open={open} />
    </ul>
  )
}

function Node({name, value, depth, open}: {name?: string; value: unknown; depth: number; open: number}) {
  const t = useT()
  const [expanded, setExpanded] = useState(depth < open)
  const label = name !== undefined && <span className="json-key">{name}: </span>
  if (value === null || typeof value !== 'object')
    return (
      <li role="treeitem" className="json-leaf">
        {label}
        <span className={`json-${value === null ? 'null' : typeof value}`}>{typeof value === 'string' ? value : String(value)}</span>
        {/* Sanity's: a document id links to it (its edit intent). */}
        {name === '_id' && typeof value === 'string' && (
          <a className="json-id-link" href={`/intent/edit/id=${encodeURIComponent(value)}/`} aria-label={t('Open {id}', {id: value})}>
            <LinkIcon />
          </a>
        )}
      </li>
    )
  const array = Array.isArray(value)
  const entries = array ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  const count = array
    ? entries.length === 1 ? t('1 item') : t('{count} items', {count: entries.length})
    : entries.length === 1 ? t('1 property') : t('{count} properties', {count: entries.length})
  return (
    <li role="treeitem" aria-expanded={entries.length ? expanded : undefined}>
      <button type="button" className="json-toggle" disabled={!entries.length} onClick={() => setExpanded((x) => !x)}>
        {/* Sanity's result has no arrow at its root; the others sit in the indent, left of the key. */}
        {depth > 0 && <span className="json-arrow" aria-hidden>{entries.length ? (expanded ? '▾' : '▸') : ''}</span>}
        {label}
        <span className="json-brace">{array ? (entries.length ? '[…]' : '[]') : entries.length ? '{…}' : '{}'}</span> <span className="json-count">{count}</span>
      </button>
      {expanded && entries.length > 0 && <Children entries={entries} depth={depth + 1} open={open} />}
    </li>
  )
}

/**
 * A big array or object draws CHUNK entries at once and the rest as they scroll near, as
 * Sanity's Vision does (it keeps item 2,000 of a result out of the page until it is near):
 * a 2,000-doc result drew 56,000 nodes at once, 0.5 s at 1x CPU and 22 MB, against Sanity's
 * 0.33 s and 10 MB. A group not drawn yet holds its place at the height the first one took.
 */
const CHUNK = 25
function Children({entries, depth, open}: {entries: (readonly [string, unknown])[]; depth: number; open: number}) {
  const list = useRef<HTMLUListElement>(null)
  const [perEntry, setPerEntry] = useState(0)
  const big = entries.length > CHUNK
  // The first group's height per entry, once drawn: what a group not drawn yet takes.
  useLayoutEffect(() => {
    if (big && !perEntry && list.current) setPerEntry(list.current.getBoundingClientRect().height / CHUNK || 1)
  }, [big, perEntry])
  const node = ([k, v]: readonly [string, unknown]) => <Node key={k} name={k} value={v} depth={depth} open={open} />
  if (!big) return <ul role="group">{entries.map(node)}</ul>
  const groups: (readonly [string, unknown])[][] = []
  for (let i = 0; i < entries.length; i += CHUNK) groups.push(entries.slice(i, i + CHUNK))
  return (
    <ul role="group" ref={list}>
      {groups.map((g, i) => (i === 0 ? g.map(node) : <Later key={g[0]![0]} entries={g} height={perEntry * g.length} node={node} />))}
    </ul>
  )
}

function Later({entries, height, node}: {entries: (readonly [string, unknown])[]; height: number; node: (e: readonly [string, unknown]) => ReactNode}) {
  const [drawn, setDrawn] = useState(false)
  const spot = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const el = spot.current
    if (drawn || !el || !height) return
    const seen = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setDrawn(true), {rootMargin: '800px 0px'})
    seen.observe(el)
    return () => seen.disconnect()
  }, [drawn, height])
  return drawn ? <>{entries.map(node)}</> : <li ref={spot} role="none" aria-hidden className="json-later" style={{height}} />
}
