import {useState} from 'react'
import {copy} from '../lib/clipboard'
import {Close as CloseIcon} from './icons'
import {SortableRows} from './SortableRows'

// Arrays of plain strings (J34), after Sanity's two layouts. `options.layout:
// "tags"` is a box of chips with an input (Enter adds; × removes). Otherwise a list
// of rows: a drag handle (mouse, or Space, arrows, Space from the keyboard), the
// value, an item "…" menu, and "Add item" below. Strings carry no _key in either
// studio, so every change writes the whole array.

type Props = {id: string; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])

export function TagsInput({id, value, onChange, readOnly}: Props) {
  const tags = list(value)
  const [text, setText] = useState('')
  return (
    <div className="tags-box" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {tags.map((t, i) => (
        <span key={i} className="tag">
          {t}
          <button type="button" aria-label={`Remove ${t}`} disabled={readOnly} onClick={() => onChange(tags.filter((_, j) => j !== i))}>
            <CloseIcon />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="tags-input"
        value={text}
        readOnly={readOnly}
        placeholder={tags.length ? undefined : 'Enter tag and press ENTER…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !text.trim()) return
          e.preventDefault()
          onChange([...tags, text.trim()])
          setText('')
        }}
      />
    </div>
  )
}

export function StringArrayInput({id, value, onChange, readOnly}: Props) {
  const items = list(value)
  return (
    <SortableRows
      id={id}
      items={items}
      onChange={onChange}
      readOnly={readOnly}
      blank={() => ''}
      onCopy={(v, i) => copy({kind: 'field', field: {name: `${id}[${i}]`, sig: 'string', value: v}})}
      renderItem={(v, i) => <input id={`${id}[${i}]`} className="input" aria-label={`Item ${i + 1}`} value={v} readOnly={readOnly} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />}
    />
  )
}
