import {ptChanges, type PtChange, type PtPart} from '../lib/pt-diff'
import type {Segment} from '../lib/changes'
import {userColorVars} from '../lib/user-colors'
import {useT} from '../lib/i18n'

// Review changes for a Portable Text field (lib/pt-diff.ts): each changed block's words,
// removed struck through and added marked, in its author's colour as the other diffs; a
// table cell by cell, each under its row and column.

const startCase = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function PtChanges({before, after, author}: {before: unknown; after: unknown; author?: string}) {
  const t = useT()
  const by = (what: string) => (author ? t(`${what} by {author}`, {author}) : t(what))
  const words = (segments: Segment[]) => segments.map((s, i) => (s.kind === 'added' ? <ins key={i} title={by('Added')}>{s.text}</ins> : s.kind === 'removed' ? <del key={i} title={by('Removed')}>{s.text}</del> : <span key={i}>{s.text}</span>))
  // What happened to a block or a cell with no words to show (an empty row, a block's formatting).
  const said = (change: PtChange['change']) => <span className="review-pt-note">{t(change === 'added' ? 'Added' : change === 'removed' ? 'Removed' : 'Changed')}</span>
  const part = (p: PtPart, i: number) => (
    <li key={i}>
      <span className="review-pt-where">{p.column ? t('Row {row}, column {column}', {row: p.row, column: p.column}) : t('Row {row}', {row: p.row})}</span>
      {p.segments.length ? words(p.segments) : said(p.change)}
    </li>
  )
  return (
    <ul className="review-diff review-pt" style={userColorVars(author ?? 'unknown')}>
      {ptChanges(before, after).map((c) => (
        <li key={`${c.kind}:${c.key}`} data-kind={c.kind} data-change={c.change}>
          {c.kind === 'text' && (c.segments.some((s) => s.kind !== 'same') ? words(c.segments) : <>{words(c.segments)} {said(c.change)}</>)}
          {c.kind === 'object' && <><span className="review-pt-label">{startCase(c.type)}</span> {said(c.change)}</>}
          {c.kind === 'table' && (
            <>
              <span className="review-pt-label">{t('Table')}</span> {(c.change !== 'changed' || !c.parts.length) && said(c.change)}
              {c.parts.length > 0 && <ul className="review-pt-cells">{c.parts.map(part)}</ul>}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
