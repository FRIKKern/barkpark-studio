import {useContext, useEffect, useRef} from 'react'
import {itemPath, refId, refTypesOf, type Field, type RefFilter} from '../lib/data'
import {copy} from '../lib/clipboard'
import {ProblemMark, ProblemsContext, type OpenRef} from './Fields'
import {RefPreview} from './Preview'
import {RefInput} from './RefInput'
import {SortableRows} from './SortableRows'

// Arrays of references (J09), after Sanity's: keyed rows ({_key, _type, _ref}),
// each a preview that opens the doc in the next pane; the row's "…" menu adds
// Replace; "Add item" adds a row with the reference search open.

type Item = {_key?: string; _type?: string; _ref?: string}
const newKey = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

export function RefArrayInput({id, field, value, onChange, readOnly, openRef}: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}) {
  // Old data may hold bare ids: give them the keyed shape on the next write.
  const items = (Array.isArray(value) ? value : []).map((v) => (typeof v === 'string' ? {_key: newKey(), _type: 'reference', _ref: v} : (v as Item)))
  const types = refTypesOf(field.of)
  const set = (next: Item[]) => onChange(next)
  // The row just added (or set to Replace): its search takes focus as it mounts, so
  // typing searches at once (Sanity's). Once only.
  const focusKey = useRef<string | undefined>(undefined)
  useEffect(() => {
    focusKey.current = undefined
  })
  const problems = useContext(ProblemsContext)
  return (
    <SortableRows
      id={id}
      items={items}
      onChange={set}
      readOnly={readOnly}
      keyOf={(it, i) => it._key ?? i}
      blank={() => ({_key: newKey(), _type: 'reference'})}
      duplicate={(it) => ({...it, _key: newKey()})}
      onCopy={(it, i) => copy({kind: 'field', field: {name: `${id}[${i}]`, sig: `reference:${types.join(',')}`, value: refId(it)}})}
      onAdded={(at, next) => (focusKey.current = next[at]?._key)}
      itemId={(it, i) => itemPath(id, it, i)}
      extraActions={(it, i) => {
        const ref = refId(it)
        if (!ref) return []
        return [
          {label: 'Replace', run: () => { focusKey.current = it._key; set(items.map((x, j) => (j === i ? {_key: x._key, _type: 'reference'} : x))) }},
          {label: 'Open in new tab', run: () => window.open(`/structure/${types[0]};${ref}`, '_blank'), last: true},
        ]
      }}
      renderItem={(it, i) => {
        const ref = refId(it)
        const link = (target: string, type: string) => openRef(type, target, itemPath(id, it, i))
        return ref ? (
          <div className="ref-row-preview">
            <RefPreview type={types[0]!} id={ref} {...link(ref, types[0]!)} />
          </div>
        ) : (
          <div className="ref-row-search">
            {/* Sanity's: an empty row is labelled, and marked as a validation error. */}
            <div className="ref-row-label">
              Reference to {types.join(' or ')}
              <ProblemMark path={itemPath(id, it, i)} />
            </div>
            <RefInput
              invalid={problems.some((p) => p.path === itemPath(id, it, i) && p.level === 'error') || undefined}
              id={itemPath(id, it, i)}
              types={types}
              filter={field.of?.options && !Array.isArray(field.of.options) ? (field.of.options.filter as RefFilter | undefined) : undefined}
              value={undefined}
              onChange={(v) => v && set(items.map((x, j) => (j === i ? {...x, _type: 'reference', _ref: v} : x)))}
              linkFor={(target, type) => link(target, type)}
              autoFocus={it._key !== undefined && it._key === focusKey.current}
            />
          </div>
        )
      }}
    />
  )
}
