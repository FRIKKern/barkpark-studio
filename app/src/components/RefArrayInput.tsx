import {useEffect, useRef} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {docQuery, itemPath, refId, refOpenType, refTypesOf, type Doc, type Field} from '../lib/data'
import {refTarget} from '../lib/refs'
import {refFilterOf} from '../lib/ref-filter'
import {copyItem, signature} from '../lib/clipboard'
import {ProblemMark, useProblems, type OpenRef} from './Fields'
import {DocPreview} from './Preview'
import {RefInput, Unavailable} from './RefInput'
import {RefStrength} from './RefStrength'
import {SortableRows} from './SortableRows'
import {maxItems} from '../lib/array-max'
import {LaunchIcon, SyncIcon} from './icons'
import {useT} from '../lib/i18n'

// Arrays of references (J09), after Sanity's: keyed rows ({_key, _type, _ref}),
// each a preview that opens the doc in the next pane; the row's "…" menu adds
// Replace; "Add item" adds a row with the reference search open.

type Item = {_key?: string; _type?: string; _ref?: string; _weak?: boolean}
const newKey = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

export function RefArrayInput({id, field, value, onChange, readOnly, openRef}: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}) {
  const t = useT()
  // Old data may hold bare ids: give them the keyed shape on the next write.
  const items = (Array.isArray(value) ? value : []).map((v) => (typeof v === 'string' ? {_key: newKey(), _type: 'reference', _ref: v} : (v as Item)))
  const types = refTypesOf(field.of)
  // Sanity's `of: [{type: 'reference', weak: true}]`: each pick stores `_weak: true`.
  const weak = field.of?.weak
  const set = (next: Item[]) => onChange(next)
  const setRow = (i: number, v: unknown) => set(items.map((x, j) => (j === i ? (typeof v === 'string' ? {...x, _type: 'reference', _ref: v} : (v as Item)) : x)))
  // The row just added (or set to Replace): its search takes focus as it mounts, so
  // typing searches at once (Sanity's). Once only.
  const focusKey = useRef<string | undefined>(undefined)
  useEffect(() => {
    focusKey.current = undefined
  })
  const problems = useProblems()
  const qc = useQueryClient()
  return (
    <SortableRows
      id={id}
      items={items}
      onChange={set}
      options={field.options}
      max={maxItems(field.validation)}
      readOnly={readOnly}
      keyOf={(it, i) => it._key ?? i}
      blank={() => ({_key: newKey(), _type: 'reference'})}
      duplicate={(it) => ({...it, _key: newKey()})}
      onCopy={(it, i) => copyItem(id, i, signature(field), it)}
      onAdded={(at, next) => (focusKey.current = next[at]?._key)}
      itemId={(it, i) => itemPath(id, it, i)}
      extraActions={(it, i) => {
        const ref = refId(it)
        if (!ref) return []
        return [
          {label: t('Replace'), icon: <SyncIcon />, run: () => { focusKey.current = it._key; set(items.map((x, j) => (j === i ? {_key: x._key, _type: 'reference'} : x))) }},
          {label: t('Open in new tab'), icon: <LaunchIcon />, run: () => window.open(`/structure/${refOpenType(types, qc.getQueryData<Doc | null>(['doc', ref]))};${ref}`, '_blank'), last: true},
        ]
      }}
      renderItem={(it, i) => {
        const ref = refId(it)
        const link = (target: string, type: string) => openRef(type, target, itemPath(id, it, i))
        return ref ? (
          // A filled row's own problem (a target not published, task-e65341609dbe504b): its mark, and
          // the id the validation panel's jump focuses (DocumentPane fieldEl), as an empty row's.
          <div className="ref-row-preview" id={itemPath(id, it, i)} tabIndex={-1}>
            <RefRow types={types} id={ref} link={(type) => link(ref, type)} />
            <ProblemMark path={itemPath(id, it, i)} />
            {/* Sanity's strip on the row; a read-only array's button is disabled (nothing written by looking). */}
            <RefRowStrength types={types} id={ref} stored={it} weak={weak} readOnly={readOnly} onConvert={(v) => setRow(i, v)} />
          </div>
        ) : (
          <div className="ref-row-search">
            {/* Sanity's: an empty row is labelled, and marked as a validation error. */}
            <div className="ref-row-label">
              {t('Reference to {types}', {types: types.join(t(' or '))})}
              <ProblemMark path={itemPath(id, it, i)} />
            </div>
            <RefInput
              invalid={problems.some((p) => p.path === itemPath(id, it, i) && p.level === 'error') || undefined}
              id={itemPath(id, it, i)}
              types={types}
              filter={refFilterOf(field.of?.options)}
              value={undefined}
              stored={it}
              weak={weak}
              onChange={(v) => v && setRow(i, v)}
              linkFor={(target, type) => link(target, type)}
              autoFocus={it._key !== undefined && it._key === focusKey.current}
            />
          </div>
        )
      }}
    />
  )
}

/**
 * A filled row: the target read as any of the reference's types, and opened as its own type.
 * Read as the first type alone, a byline to person or contributor stayed at "…" for every
 * contributor (task-e0d7229807a2baf7). A target no document holds reads null and shows
 * Sanity's unavailable mark, as RefInput does; it showed "…" forever (task-d7b1d4fefe18fce6).
 */
/** The strip once the row's target is read and there (an unavailable one says so instead). */
function RefRowStrength({types, id, stored, weak, readOnly, onConvert}: {types: string[]; id: string; stored: unknown; weak?: boolean; readOnly?: boolean; onConvert: (v: unknown) => void}) {
  const {data} = useQuery({...docQuery(types, id), enabled: types.length > 0})
  if (refTarget(data) !== 'found') return null
  return readOnly ? <fieldset className="readonly-wrap" disabled><RefStrength stored={stored} weak={weak} onConvert={onConvert} /></fieldset> : <RefStrength stored={stored} weak={weak} onConvert={onConvert} />
}

function RefRow({types, id, link}: {types: string[]; id: string; link: (type: string) => {href: string; selected: boolean; active: boolean}}) {
  const {data} = useQuery({...docQuery(types, id), enabled: types.length > 0})
  if (refTarget(data) === 'missing') return <Unavailable id={id} />
  return <DocPreview doc={data} {...link(refOpenType(types, data) ?? '')} />
}
