import {textDiff} from '../lib/changes'
import {tableDiff} from '../lib/table-diff'
import {useT} from '../lib/i18n'

// Review changes for a table field (lib/table-diff.ts): the table before and after as one
// grid. A changed cell shows its words removed and added, as a text field's diff; an added
// or removed row or column is marked whole, where it was. A long table shows the rows that
// changed only.

const SHOW_ALL = 12

export function TableChanges({before, after, title, by}: {before: unknown; after: unknown; title?: string; by: (what: string) => string}) {
  const t = useT()
  const d = tableDiff(before, after)
  const rows = d.rows.length > SHOW_ALL ? d.rows.filter((r) => r.change !== 'same' || r.cells.some((c) => c.change !== 'same')) : d.rows
  const mark = (change: 'same' | 'changed' | 'added' | 'removed', text: string | number) => (change === 'added' ? <ins title={by('Added')}>{text}</ins> : change === 'removed' ? <del title={by('Removed')}>{text}</del> : text)
  return (
    <div className="review-diff review-table">
      <table aria-label={title ?? t('Table')}>
        <thead>
          <tr>
            <td />
            {d.columns.map((c, j) => (
              <th key={j} scope="col" data-change={c.change} aria-label={t('Column {column}', {column: c.after || c.before})}>
                {mark(c.change, c.after || c.before)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.key}:${r.change}`} data-change={r.change}>
              <th scope="row" data-change={r.change === 'changed' ? 'same' : r.change} aria-label={t('Row {row}', {row: r.after || r.before})}>
                {mark(r.change === 'changed' ? 'same' : r.change, r.after || r.before)}
              </th>
              {r.cells.map((c, j) => (
                <td key={j} data-change={c.change}>
                  {c.change === 'changed' ? textDiff(c.before, c.after).map((s, i) => (s.kind === 'added' ? <ins key={i} title={by('Added')}>{s.text}</ins> : s.kind === 'removed' ? <del key={i} title={by('Removed')}>{s.text}</del> : <span key={i}>{s.text}</span>)) : mark(c.change, c.change === 'removed' ? c.before : c.after)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length < d.rows.length && <p className="review-table-note">{t('Unchanged rows: {count}', {count: d.rows.length - rows.length})}</p>}
    </div>
  )
}

/** A table as plain markup, nothing in it to focus: a Portable Text block's card. */
export function TableStatic({value}: {value: unknown}) {
  const t = useT()
  const d = tableDiff(value, value)
  if (!d.rows.length) return <span className="table-static muted">{t('Empty Table')}</span>
  return (
    <span className="table-static">
      <table>
        <tbody>
          {d.rows.slice(0, 20).map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, j) => (
                <td key={j}>{c.after}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </span>
  )
}
