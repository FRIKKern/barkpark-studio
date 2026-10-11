import {useState} from 'react'
import {useT} from '../lib/i18n'

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
        <span className="json-arrow" aria-hidden>{entries.length ? (expanded ? '▾' : '▸') : ''}</span>
        {label}
        <span className="json-brace">{array ? (entries.length ? '[…]' : '[]') : entries.length ? '{…}' : '{}'}</span> <span className="json-count">{count}</span>
      </button>
      {expanded && entries.length > 0 && (
        <ul role="group">
          {entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} open={open} />
          ))}
        </ul>
      )}
    </li>
  )
}
